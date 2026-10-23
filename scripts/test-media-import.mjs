import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const uri = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const moduleURI = uri(compile(await readFile(new URL('../supabase/functions/_shared/xhs.ts', import.meta.url), 'utf8')));
const { sourceURL, mediaURL, parseNote, readNote, readMedia, detectType, bounded } = await import(moduleURI);
const id = '6a0d87a300000000350264e3';
const imageURL = 'http://sns-webpic-qc.xhscdn.com/synthetic.jpg';
const videoURL = 'http://sns-video-v3.xhscdn.com/synthetic.mp4';
const note = { noteId: id, title: 'undefined stays text', desc: '实际文字', type: 'normal', imageList: [{ url: imageURL }] };
const html = n => `<script>window.__INITIAL_STATE__=${JSON.stringify({ noteData: { data: { noteData: n } }, unused: 'undefined' }).replace('"unused":"undefined"', '"unused":undefined')};</script>`;
assert.equal(parseNote(html(note), id).title, 'undefined stays text');
assert.equal(parseNote(html(note), id).media[0].url, imageURL.replace('http:', 'https:'));
assert.throws(() => parseNote(html({ ...note, noteId: 'other' }), id), /推荐流/);
assert.throws(() => parseNote('<script>window.__INITIAL_STATE__={x:process.exit()}</script>', id), /格式/);
for (const url of ['http://127.0.0.1', 'https://xhslink.cn.attacker.test/a', 'https://u:p@xhslink.cn/a', 'https://xhslink.cn:123/a']) assert.throws(() => sourceURL(url));
for (const url of ['https://127.0.0.1/x.jpg', 'https://evil.test/a', 'https://xhscdn.com.attacker.test/a', 'https://u:p@sns-webpic.xhscdn.com/a']) assert.equal(mediaURL(url), '');
const mp4 = new Uint8Array(32); mp4.set(Buffer.from('ftypisom'), 4);
assert.equal(detectType(mp4, 'video'), 'video/mp4');
assert.throws(() => detectType(Buffer.from('<html>login</html>'), 'video'));
await assert.rejects(() => bounded(new Response(new Uint8Array(10)), 5), /大小限制/);
await assert.rejects(() => readNote(`https://www.xiaohongshu.com/explore/${id}`, async () => new Response(null, { status: 302, headers: { Location: 'https://evil.test/' } })), /官方分享/);
await assert.rejects(() => readNote(`https://www.xiaohongshu.com/explore/${id}`, async () => new Response(null, { status: 302, headers: { Location: '/login' } })), /要求登录/);
const videoNote = { ...note, type: 'video', video: { media: { video: { drmType: 0 }, stream: { h264: [{ format: 'mp4', size: 32, masterUrl: videoURL, width: 1280 }] } } } };
assert.deepEqual(parseNote(html(videoNote), id).media.map(x => x.kind), ['video', 'image']);
let handler;
globalThis.Deno = { env: { get: k => ({ SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_synthetic"}' })[k] }, serve: h => { handler = h; } };
await import(uri(compile(await readFile(new URL('../supabase/functions/media-import/index.ts', import.meta.url), 'utf8')).replace("'../_shared/xhs.ts'", JSON.stringify(moduleURI))));
const realFetch = globalThis.fetch;
let savedRows = [], stored = [], patched, foreign = false, unauthorized = false, mode = 'image';
const itemId = '11111111-2222-4333-a444-555555555555';
const uid = '99999999-8888-4777-a666-555555555555';
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith('https://synthetic.supabase.co')) {
    const headers = new Headers(init.headers);
    assert.equal(headers.get('Authorization'), 'Bearer synthetic-user-token');
    assert.equal(headers.get('apikey'), 'sb_publishable_synthetic');
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: uid }, { status: unauthorized ? 401 : 200 });
    if (url.includes('/rpc/')) return Response.json(null);
    if (url.includes('/inspiration_images')) {
      if (init.method === 'POST') { savedRows.push(JSON.parse(init.body)); return Response.json(savedRows); }
      return Response.json(savedRows);
    }
    if (url.includes('/inspirations?')) {
      assert.ok(url.includes(`user_id=eq.${uid}`));
      if (init.method === 'PATCH') { patched = JSON.parse(init.body); return Response.json([{ id: itemId, ...patched }]); }
      return Response.json(foreign ? [] : [{ id: itemId, source_url: `https://www.xiaohongshu.com/explore/${id}` }]);
    }
    if (url.includes('/storage/v1/object/')) { stored.push(url.includes('portrait-videos') ? 'video' : 'image'); return Response.json({}); }
    throw new Error('Unexpected cloud path');
  }
  assert.equal(new Headers(init.headers).has('Authorization'), false, 'Caller JWT must never reach Xiaohongshu or CDN');
  if (url.includes('www.xiaohongshu.com')) return new Response(html(mode === 'video' ? videoNote : note));
  if (url.includes('sns-video-v3.xhscdn.com')) return new Response(mp4);
  if (url.includes('sns-webpic-qc.xhscdn.com')) return new Response(new Uint8Array([255, 216, 255, 1]));
  throw new Error('Unexpected external host');
};
const request = () => new Request('https://synthetic.supabase.co/functions/v1/media-import', { method: 'POST', headers: { Authorization: 'Bearer synthetic-user-token', Origin: 'https://59rion.github.io' }, body: JSON.stringify({ inspirationId: itemId }) });
assert.equal((await handler(new Request('https://synthetic.test', { method: 'POST' }))).status, 401);
foreign = true; assert.equal((await handler(request())).status, 404); foreign = false;
unauthorized = true; assert.equal((await handler(request())).status, 401); unauthorized = false;
for (mode of ['image', 'video']) {
  savedRows = []; stored = []; patched = null;
  const response = await handler(request());
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.videoCount, mode === 'video' ? 1 : 0);
  assert.ok(savedRows.every(row => row.user_id === uid && row.inspiration_id === itemId && row.storage_key.startsWith(`users/${uid}/`)));
  assert.equal(patched.status, 'ready');
  assert.ok(patched.imported_at > 0);
  assert.equal(stored.length, mode === 'video' ? 2 : 1);
}
globalThis.fetch = realFetch;
delete globalThis.Deno;
console.log('Media import fixtures passed: targeted SSR, image/MP4 validation, bounded files, redirect allowlist, caller auth/RLS, private uploads and metadata.');
if (process.argv.includes('--live')) {
  for (const [label, url] of [['image', 'https://xhslink.cn/o/51TacjTQ23G'], ['video', 'https://xhslink.cn/o/AajK6vJoR04']]) {
    const result = await readNote(url);
    let bytes = 0, images = 0, videos = 0;
    for (const media of result.media) {
      const file = await readMedia(media.url, media.kind);
      bytes += file.bytes.length;
      if (media.kind === 'video') videos++; else images++;
    }
    console.log(JSON.stringify({ live: label, title: result.title, images, videos, bytes, skipped: result.skipped, cloudWrite: false }));
  }
}

