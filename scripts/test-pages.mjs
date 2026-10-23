import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../pages/cloud.ts', import.meta.url), 'utf8');
const shared = ts.transpileModule(await readFile(new URL('../lib/shooting.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const sharedUri = `data:text/javascript;base64,${Buffer.from(shared).toString('base64')}`;
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace("'../lib/shooting'", JSON.stringify(sharedUri));
const { Cloud, validateConfig } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const memory = new Map();
globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
globalThis.location = { origin: 'https://59rion.github.io' };
const config = { url: 'https://test-project.supabase.co', key: 'sb_publishable_test_only' };
assert.throws(() => validateConfig({ ...config, url: 'http://127.0.0.1' }));
assert.throws(() => validateConfig({ ...config, key: 'sb_secret_test_only' }));
assert.throws(() => validateConfig({ ...config, key: `e30.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.test` }));
const client = new Cloud(config);
let calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  if (url.includes('/auth/v1/token')) return Response.json({ access_token: 'refreshed-test-token', refresh_token: 'test-refresh', expires_in: 3600, user: { id: 'test-user', email: 'test@example.com' } });
  assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer refreshed-test-token');
  if (url.includes('/storage/')) return Response.json({ signedURL: '/object/sign/portrait-images/test?token=test' });
  return Response.json([]);
};
client.setSession({ access_token: 'expired-test-token', refresh_token: 'test-refresh', expires_at: 0, user: { id: 'test-user', email: 'test@example.com' } });
await Promise.all([client.table('inspirations'), client.table('user_tags')]);
assert.equal(calls.filter(c => c.url.includes('/auth/v1/token')).length, 1, 'Concurrent calls share one session refresh');
assert.match(await client.signedUrl('users/test-user/photo'), /^https:\/\/test-project\.supabase\.co\/storage\/v1\/object\/sign\//);
const imageRequest = calls.find(c => c.url.includes('/storage/'));
assert.ok(imageRequest.url.includes('/object/sign/portrait-images/'), 'Images require a private signed URL');
globalThis.fetch = async () => Response.json({ message: 'Access denied' }, { status: 403 });
const denied = await client.transport('/api/inspirations');
assert.equal(denied.ok, false);
assert.equal((await denied.json()).error, 'Access denied');
client.setSession(null);
calls = [];
globalThis.fetch = async () => { calls.push(1); throw new Error('Unexpected request'); };
const anonymous = await client.transport('/api/inspirations');
assert.equal(anonymous.ok, false);
assert.equal(calls.length, 0, 'Signed-out clients cannot dispatch database requests');
// A paused project / unavailable DNS must not be reported as a bad password.
for (const failure of [new TypeError('Failed to fetch'), new DOMException('Timed out', 'TimeoutError')]) {
  globalThis.fetch = async () => { throw failure; };
  await assert.rejects(() => client.auth('token?grant_type=password', { email: 'test@example.invalid', password: 'synthetic-only' }), /无法连接登录服务/);
  assert.equal(client.session, null);
}
globalThis.fetch = async () => new Response('<html>Service unavailable</html>', { status: 503 });
await assert.rejects(() => client.auth('settings'), /登录服务暂时不可用/);
globalThis.fetch = async () => new Response('invalid JSON', { status: 200 });
await assert.rejects(() => client.checkAuthConnection(), /登录服务暂时不可用/);
globalThis.fetch = async () => Response.json({ code: 'invalid_credentials' }, { status: 400 });
await assert.rejects(() => client.auth('token?grant_type=password', {}), /邮箱或密码不正确/);
globalThis.fetch = async () => Response.json({ code: 'email_address_not_authorized' }, { status: 403 });
await assert.rejects(() => client.auth('signup', {}), /邮件服务暂不允许/);
globalThis.fetch = async (_url, init) => {
  assert.equal(new Headers(init.headers).get('Authorization'), null, 'Connection probe never forwards a user token');
  return Response.json({ disable_signup: false, mailer_autoconfirm: false });
};
assert.deepEqual(await client.checkAuthConnection(), { signupEnabled: true, emailVerificationRequired: true });
assert.equal(client.session, null, 'Public connection probe cannot create a session');
console.log('Pages cloud adapter: configuration, concurrent session refresh, private image URL, access denial and logout checks passed.');
