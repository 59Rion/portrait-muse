import { bounded, MediaError, readNote, readMedia } from '../_shared/xhs.ts';
declare const Deno: { env: { get(name: string): string | undefined }; createHttpClient?(options: { http1: boolean; http2: boolean }): unknown; serve(handler: (request: Request) => Promise<Response>): void };
// Keep normal certificate validation; avoid the upstream HTTP/2 handshake stall.
const externalClient = Deno.createHttpClient?.({ http1: true, http2: false });
const externalFetch: typeof fetch = async (url, init) => {
  console.info(JSON.stringify({ event: 'media_source_request', host: new URL(String(url)).hostname, transport: externalClient ? 'http1' : 'default' }));
  const response = await fetch(url, { ...init, ...(externalClient ? { client: externalClient } : {}) } as RequestInit);
  console.info(JSON.stringify({ event: 'media_source_response', host: new URL(String(url)).hostname, status: response.status }));
  return response;
};
const origin = 'https://59rion.github.io';
const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin', 'Cache-Control': 'no-store' };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: cors });
Deno.serve(async request => {
  const started = Date.now();
  if (request.headers.get('Origin') && request.headers.get('Origin') !== origin) return json({ error: 'Origin not allowed' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const base = Deno.env.get('SUPABASE_URL') || '';
  const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
  const key = keys.default || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ') || authorization.length > 10000) return json({ error: '请先登录。' }, 401);
  const headers = { apikey: key, Authorization: authorization };
  let stage = 'auth';
  const diagnostic = (error: unknown) => {
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.error(JSON.stringify({ event: 'media_import_failed', stage, name }));
  };
  // Every cloud operation uses the verified caller JWT and existing RLS, never an admin key.
  async function cloud(path: string, init: RequestInit = {}): Promise<any> {
    const response = await fetch(base + path, { ...init, headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation', ...init.headers }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { message?: string };
      if (path.includes('/rpc/') && /请求过于频繁|正在导入/.test(data.message || '')) throw new MediaError(data.message!, 429);
      throw new MediaError(response.status === 401 || response.status === 403 ? '登录状态失效或没有操作权限。' : '私有图库暂时无法读写，请稍后重试。', response.status === 401 || response.status === 403 ? 401 : 502);
    }
    return response.json().catch(() => null);
  }
  try {
    const user = await cloud('/auth/v1/user');
    const raw = new TextDecoder().decode(await bounded(new Response(request.body), 1024));
    let input: any;
    try { input = JSON.parse(raw); } catch { throw new MediaError('请求格式不正确。'); }
    const id = input.inspirationId;
    if (Object.keys(input).length !== 1 || typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) throw new MediaError('收藏 ID 不正确。');
    const query = `id=eq.${id}&user_id=eq.${user.id}`;
    stage = 'read_record';
    const [item] = await cloud(`/rest/v1/inspirations?${query}&select=*`);
    if (!item?.source_url) throw new MediaError('收藏不存在、没有分享链接或不属于当前账号。', 404);
    const existing = await cloud(`/rest/v1/inspiration_images?inspiration_id=eq.${id}&user_id=eq.${user.id}&order=position.asc`);
    if (item.imported_at && existing.length) return json({ count: existing.length, message: '这篇笔记的媒体已经导入，无需重复下载。' });
    stage = 'claim';
    await cloud('/rest/v1/rpc/claim_portrait_import', { method: 'POST', body: JSON.stringify({ p_id: id }) });
    stage = 'read_note';
    const note = await readNote(item.source_url, externalFetch);
    let size = 0, saved = 0, imageCount = 0, videoCount = 0, failure = '';
    let cover = item.cover_key;
    let position = Math.max(-1, ...existing.map((x: any) => x.position));
    for (const [index, media] of note.media.entries()) {
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${id}:${note.noteId}:${media.kind}:${index}`)));
      const hex = Array.from(hash.slice(0, 16), x => x.toString(16).padStart(2, '0')).join('');
      const mediaId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
      const bucket = media.kind === 'video' ? 'portrait-videos' : 'portrait-images';
      const storageKey = `users/${user.id}/inspirations/${id}/${mediaId}`;
      if (existing.some((x: any) => x.id === mediaId)) { saved++; if (media.kind === 'video') videoCount++; else { imageCount++; cover ||= storageKey; } continue; }
      try {
        // Reserve time for a final fetch, two cloud writes and the status patch
        // within the free runtime's 150-second wall-clock limit.
        if (Date.now() - started > 70000) throw new MediaError('本次导入达到时间限制，可稍后重试补齐。');
        stage = 'read_media';
        const { bytes, contentType } = await readMedia(media.url, media.kind, externalFetch);
        size += bytes.length;
        if (size > 60_000_000) throw new MediaError('本次导入总大小超过 60 MB，请分次保存。');
        stage = 'upload_media';
        await cloud(`/storage/v1/object/${bucket}/${storageKey}`, { method: 'POST', headers: { 'Content-Type': contentType, 'x-upsert': 'true' }, body: bytes as unknown as BodyInit });
        try {
          stage = 'save_metadata';
          await cloud('/rest/v1/inspiration_images?on_conflict=id', { method: 'POST', headers: { Prefer: 'return=representation,resolution=merge-duplicates' }, body: JSON.stringify({ id: mediaId, inspiration_id: id, user_id: user.id, storage_key: storageKey, media_bucket: bucket, filename: `xiaohongshu-${index + 1}.${media.kind === 'video' ? 'mp4' : contentType.split('/')[1]}`, content_type: contentType, position: ++position }) });
        } catch (error) {
          await cloud(`/storage/v1/object/${bucket}`, { method: 'DELETE', body: JSON.stringify({ prefixes: [storageKey] }) }).catch(() => {});
          throw error;
        }
        saved++;
        if (media.kind === 'video') videoCount++; else { imageCount++; cover ||= storageKey; }
      } catch (error) { diagnostic(error); failure = error instanceof MediaError ? error.message : `媒体读取或保存失败（${stage}），请稍后重试。`; break; }
    }
    if (!saved) throw new MediaError(failure || '未能下载任何媒体，原链接仍保留。', 422);
    const message = `已保存 ${imageCount} 张图片、${videoCount} 个视频。${failure ? `部分未完成：${failure} 请稍后在详情重试。` : ''}${note.skipped ? `另有 ${note.skipped} 项超过单次数量限制。` : ''}`;
    stage = 'finish';
    await cloud(`/rest/v1/inspirations?${query}`, { method: 'PATCH', body: JSON.stringify({ title: note.title, description: note.description, status: 'ready', cover_key: cover || null, summary: message, imported_at: failure || note.skipped ? 0 : Date.now(), updated_at: Date.now() }) });
    return json({ count: saved, imageCount, videoCount, skipped: note.skipped, partial: Boolean(failure), message });
  } catch (error) {
    diagnostic(error);
    const message = stage === 'read_note' ? '云端连接小红书笔记失败或超时，尚未开始下载图片。链接仍保留。' : `导入在 ${stage} 阶段失败，链接仍保留。`;
    return json({ error: error instanceof MediaError ? error.message : message, stage }, error instanceof MediaError ? error.status : 502);
  }
});

