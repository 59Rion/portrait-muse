import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const uri = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const sharedUri = uri(compile(await readFile(new URL('../lib/shooting.ts', import.meta.url), 'utf8')));
const { Cloud, validateConfig } = await import(uri(compile(await readFile(new URL('../pages/cloud.ts', import.meta.url), 'utf8')).replace("'../lib/shooting'", JSON.stringify(sharedUri))));
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.location = { origin: 'https://59rion.github.io' };
const config = { url: 'https://test.supabase.co', key: 'sb_publishable_test', downloaderUrl: 'https://test-importer.onrender.com' };
assert.throws(() => validateConfig({ ...config, downloaderUrl: 'http://localhost:1234' }));
const client = new Cloud(config);
client.setSession({ access_token: 'synthetic-token', refresh_token: 'synthetic-refresh', expires_at: 9999999999, user: { id: 'test-user', email: 'test@example.invalid' } });
let row, restricted = false, imports = 0;
globalThis.fetch = async (url, init) => {
  const headers = new Headers(init.headers);
  if (url.startsWith(config.downloaderUrl)) {
    imports++;
    assert.equal(headers.get('Authorization'), 'Bearer synthetic-token');
    assert.equal(headers.get('apikey'), null);
    assert.deepEqual(JSON.parse(init.body), { inspirationId: row.id }, 'Only owned record ID is sent, no source URL, Cookie or admin key');
    if (restricted) return Response.json({ error: '平台暂时限制下载' }, { status: 400 });
    row = { ...row, cover_key: 'users/test-user/image', status: 'ready' };
    return Response.json({ count: 2, skipped: 0, message: '已保存 2 张图片' });
  }
  assert.equal(headers.get('apikey'), config.key);
  if (url.includes('/object/sign/')) return Response.json({ signedURL: '/object/sign/portrait-images/synthetic?token=test' });
  if (url.includes('user_tags')) return Response.json([]);
  if (url.includes('source_url=eq.')) return Response.json([]);
  if (init.method === 'POST') { row = JSON.parse(init.body); return Response.json([row]); }
  return Response.json([row]);
};
function share() { const form = new FormData(); form.set('sharedText', '窗边清冷参考 https://xhslink.cn/o/test 先复制一下，再到【小红书】打开查看笔记。'); return form; }
const success = await client.transport('/api/inspirations', { method: 'POST', body: share() });
assert.equal(success.status, 201);
assert.equal((await success.json()).inspiration.status, 'ready');
restricted = true;
const failure = await client.transport('/api/inspirations', { method: 'POST', body: share() });
const saved = await failure.json();
assert.equal(failure.status, 201, 'The original link remains saved even when image import fails');
assert.equal(saved.inspiration.status, 'needs_upload');
assert.match(saved.downloadWarning, /平台暂时限制下载/);
assert.equal(imports, 2);
client.setSession(null);
await assert.rejects(() => client.downloadRemote(row.id), /先登录/);
assert.equal(imports, 2);
console.log('Downloader adapter: private token forwarding, source-ID-only requests, successful image refresh, failure retaining links and signed-out refusal passed with synthetic fixtures.');
