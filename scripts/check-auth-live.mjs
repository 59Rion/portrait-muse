// Public checks with deliberately invalid input: no real user credentials or account creation.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { url, key } = JSON.parse(await readFile(new URL('../pages/deployment.json', import.meta.url), 'utf8'));
const headers = { apikey: key, Origin: 'https://59rion.github.io', 'Content-Type': 'application/json' };
const request = (path, init = {}) => fetch(`${url}/auth/v1/${path}`, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(15000) });
const settingsResponse = await request('settings');
assert.equal(settingsResponse.status, 200);
const settings = await settingsResponse.json();
assert.equal(settings.disable_signup, false);
assert.equal(settings.mailer_autoconfirm, false, 'Email verification must remain enabled');
const results = [];
for (const path of ['token?grant_type=password', 'signup']) {
  const payload = path === 'signup' ? { email: 'invalid-email', password: 'validation-only-not-a-user-secret' } : {};
  const response = await request(path, { method: 'POST', body: JSON.stringify(payload) });
  const body = await response.json();
  assert.ok([400, 422].includes(response.status), 'Invalid input must fail validation');
  const code = body.error_code || body.code;
  assert.equal(typeof code, 'string', 'Response must come from Auth');
  assert.equal(body.access_token, undefined);
  assert.equal(body.id, undefined);
  results.push({ route: path.split('?')[0], status: response.status, code });
}
const preflight = await request('signup', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'apikey,content-type' } });
assert.ok([200, 204].includes(preflight.status));
assert.ok(['*', 'https://59rion.github.io'].includes(preflight.headers.get('access-control-allow-origin')));
console.log(JSON.stringify({ settings: 200, signupEnabled: true, emailVerificationRequired: true, routes: results, corsPreflight: preflight.status, noUserCredentialsSent: true, userLoginOrEmailDeliveryVerified: false }));
