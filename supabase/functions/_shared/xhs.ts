// Original implementation of public SSR parsing. Never execute scripts from a note.
export class MediaError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
// Read-only network requests get one bounded retry. Never retry login/captcha/429.
export async function retryRead(fetcher: typeof fetch, url: string | URL | Request, init: RequestInit = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(attempt ? 12000 : 8000) });
      if (attempt === 0 && [500, 502, 503, 504].includes(response.status)) { await response.body?.cancel(); continue; }
      return response;
    } catch (error) {
      if (attempt || !(error instanceof Error) || !['TimeoutError', 'AbortError', 'TypeError'].includes(error.name)) throw error;
    }
  }
  throw new MediaError('读取超时，请稍后重试。', 504);
}
const sourceHosts = new Set(['www.xiaohongshu.com', 'xiaohongshu.com', 'xhslink.cn', 'www.xhslink.cn', 'xhslink.com', 'www.xhslink.com']);
export function sourceURL(value: string) {
  const u = new URL(value);
  if (!sourceHosts.has(u.hostname) || !['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port || value.length > 4000) throw new MediaError('请使用小红书官方分享链接。');
  u.protocol = 'https:';
  return u;
}
export function mediaURL(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const u = new URL(value);
    if (!u.hostname.endsWith('.xhscdn.com') || !['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port || value.length > 8000) return '';
    u.protocol = 'https:';
    return u.href;
  } catch { return ''; }
}
export async function bounded(response: Response, limit: number) {
  if (Number(response.headers.get('content-length') || 0) > limit) { await response.body?.cancel(); throw new MediaError('媒体文件超过免费导入大小限制。', 413); }
  if (!response.body) throw new MediaError('未收到文件内容。');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new MediaError('媒体文件超过免费导入大小限制。', 413);
      chunks.push(value);
    }
  } catch (e) { await reader.cancel().catch(() => {}); throw e; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
export async function readNote(url: string, fetcher: typeof fetch = fetch) {
  let u = sourceURL(url);
  let noteId = '';
  for (let i = 0; i < 6; i++) {
    sourceURL(u.href);
    const id = u.pathname.match(/^\/(?:explore|discovery\/item)\/([a-f0-9]{24})(?:\/|$)/i)?.[1];
    if (id) {
      if (noteId && noteId !== id) throw new MediaError('链接跳转到了另一篇笔记，已停止导入。');
      noteId = id;
    } else if (u.hostname.endsWith('xiaohongshu.com')) throw new MediaError('笔记要求登录、链接已过期或受到平台限制。请重新复制分享链接。');
    const response = await fetcher(u.href, { redirect: 'manual', headers: { 'User-Agent': userAgent, Accept: 'text/html' }, signal: AbortSignal.timeout(12000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      u = sourceURL(new URL(response.headers.get('location') || '', u).href);
      continue;
    }
    if (!response.ok) throw new MediaError('小红书暂时拒绝读取该笔记，请稍后重试。');
    if (!noteId) throw new MediaError('短链接没有返回具体笔记。');
    const html = new TextDecoder().decode(await bounded(response, 2_000_000));
    return parseNote(html, noteId);
  }
  throw new MediaError('分享链接跳转过多。');
}
export function parseNote(html: string, noteId: string) {
  const start = /window\.(?:__INITIAL_STATE__|INITIAL_STATE)\s*=\s*/g.exec(html);
  if (!start) throw new MediaError('未找到笔记内容，可能需要在小红书内重新分享。');
  // Balance braces and replace only bare undefined tokens, never text inside strings.
  let raw = '', depth = 0, quoted = false, escaped = false, complete = false;
  for (let i = start.index + start[0].length; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      raw += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    if (c === '{' || c === '[') depth++;
    if (c === '}' || c === ']') depth--;
    if (html.startsWith('undefined', i) && !/[\w$]/.test(html[i - 1] || '') && !/[\w$]/.test(html[i + 9] || '')) { raw += 'null'; i += 8; }
    else raw += c;
    if (depth === 0 && raw.trim()) { complete = true; break; }
  }
  let state: any;
  try { if (!complete) throw 0; state = JSON.parse(raw); } catch { throw new MediaError('笔记页面格式已变化，解析未完成。'); }
  const note = state.note?.noteDetailMap?.[noteId]?.note || state.noteData?.data?.noteData;
  if (!note || (note.noteId || note.id) !== noteId) throw new MediaError('没有取得这篇笔记的完整内容；不会使用推荐流或头像代替。');
  const media: { url: string; kind: 'image' | 'video' }[] = [];
  for (const image of Array.isArray(note.imageList) ? note.imageList : []) {
    const url = mediaURL(image.infoList?.find((x: any) => ['H5_DTL', 'WB_DFT'].includes(x.imageScene))?.url || image.urlDefault || image.url);
    if (url && !media.some(m => m.url === url)) media.push({ url, kind: 'image' });
  }
  if (note.type === 'video') {
    if (note.video?.media?.video?.drmType) throw new MediaError('不支持受保护的视频。');
    const streams = note.video?.media?.stream?.h264 || [];
    const stream = [...streams].filter((x: any) => x.format === 'mp4' && (!x.size || x.size <= 40_000_000)).sort((a: any, b: any) => (b.width || 0) - (a.width || 0)).find((x: any) => mediaURL(x.masterUrl));
    const url = mediaURL(stream?.masterUrl);
    if (!url) throw new MediaError('没有可读取的 MP4 视频，或视频超过 40 MB。');
    media.unshift({ url, kind: 'video' });
  }
  if (!media.length) throw new MediaError('笔记中没有可读取的图片或视频。');
  return { noteId, title: String(note.title || '小红书摄影灵感').slice(0, 160), description: String(note.desc || '').slice(0, 3000), media: media.slice(0, 21), skipped: Math.max(0, media.length - 21) };
}
export function detectType(bytes: Uint8Array, kind: 'image' | 'video') {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (kind === 'video') {
    if (bytes.length > 24 && ascii(4, 8) === 'ftyp' && ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V '].includes(ascii(8, 12))) return 'video/mp4';
    throw new MediaError('下载结果不是受支持的 MP4 视频。');
  }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (ascii(1, 4) === 'PNG' && bytes[0] === 137) return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  throw new MediaError('下载结果不是受支持的图片。');
}
export async function readMedia(url: string, kind: 'image' | 'video', fetcher: typeof fetch = fetch) {
  for (let i = 0; i < 4; i++) {
    url = mediaURL(url);
    if (!url) throw new MediaError('媒体地址不是受支持的小红书 CDN。');
    const response = await fetcher(url, { redirect: 'manual', headers: { 'User-Agent': userAgent, Referer: 'https://www.xiaohongshu.com/' }, signal: AbortSignal.timeout(20000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) { await response.body?.cancel(); url = new URL(response.headers.get('location') || '', url).href; continue; }
    if (!response.ok) throw new MediaError('媒体下载受到限制或地址已过期，请重新解析。');
    const bytes = await bounded(response, kind === 'video' ? 40_000_000 : 15_000_000);
    return { bytes, contentType: detectType(bytes, kind) };
  }
  throw new MediaError('媒体地址跳转过多。');
}