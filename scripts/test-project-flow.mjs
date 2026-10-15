// Tests the actual browser adapter against an isolated in-memory REST fixture.
// This is not a PostgreSQL/RLS test and does not use real account credentials.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const uri = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const sharedUri = uri(compile(await readFile(new URL('../lib/shooting.ts', import.meta.url), 'utf8')));
const { emptyBrief, emptyPlan } = await import(sharedUri);
const { Cloud } = await import(uri(compile(await readFile(new URL('../pages/cloud.ts', import.meta.url), 'utf8')).replace("'../lib/shooting'", JSON.stringify(sharedUri))));
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.location = { origin: 'https://site.example.invalid' };
const id = '11111111-1111-1111-1111-111111111111';
const refId = '22222222-2222-2222-2222-222222222222';
const state = { briefs: [], versions: [], members: [], writes: [] };
const ref = { id: refId, title: '清冷窗边', description: '人工描述：自然光', summary: '', tags: ['清冷'], source_url: null, primary_tag: '清冷', status: 'needs_upload', cover_key: null, created_at: 1 };
globalThis.fetch = async (url, init) => {
  const path = new URL(url); const table = path.pathname.split('/').at(-1); const method = init?.method || 'GET'; const body = init?.body ? JSON.parse(init.body) : null;
  assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-session');
  if (method !== 'GET') state.writes.push({ table, body });
  if (table === 'shoot_projects') return Response.json(path.searchParams.get('id')?.includes('missing') ? [] : [{ id, name: '测试项目', created_at: 1 }]);
  if (table === 'project_briefs') {
    if (method === 'POST') state.briefs = [body];
    return Response.json(state.briefs);
  }
  if (table === 'shooting_plans') return Response.json(state.versions);
  if (table === 'project_messages') return Response.json([]);
  if (table === 'project_items') {
    if (method === 'POST') state.members = body;
    return Response.json(state.members);
  }
  if (table === 'inspirations') return Response.json([ref]);
  if (table === 'confirm_shooting_plan') {
    if (JSON.stringify(body.p_brief) !== JSON.stringify(state.briefs[0].data)) return Response.json({ message: 'Requirements changed; save and reload first' }, { status: 400 });
    const version = { id: 'version-' + state.versions.length, version: state.versions.length + 1, plan: structuredClone(body.p_plan), brief_snapshot: structuredClone(body.p_brief), note: body.p_note, origin: body.p_origin, created_at: 1 };
    state.versions.unshift(version);
    return Response.json(version);
  }
  throw new Error('Unexpected fixture path: ' + path.pathname);
};
const client = new Cloud({ url: 'https://test-project.supabase.co', key: 'sb_publishable_test_only' });
client.setSession({ access_token: 'synthetic-session', refresh_token: 'synthetic-refresh', expires_at: 9999999999, user: { id: 'test-user', email: 'test@example.invalid' } });
const get = async path => { const response = await client.transport(path); assert.equal(response.ok, true); return response.json(); };
const write = (path, body, method = 'POST') => client.transport(path, { method, body: JSON.stringify(body) });
let workspace = await get(`/api/projects/${id}`);
assert.equal(workspace.briefSaved, false);
assert.equal(state.writes.length, 0, 'Read and preview do not save anything');
const brief = { ...emptyBrief, purpose: '写真', location: '室内窗边', equipment: '手机', team: '朋友帮拍' };
assert.ok((await write(`/api/projects/${id}/brief`, { brief }, 'PUT')).ok);
workspace = await get(`/api/projects/${id}`);
assert.equal(workspace.briefSaved, true);
assert.equal(workspace.brief.team, '朋友帮拍');
const search = await get('/api/references?query=' + encodeURIComponent('清冷'));
assert.equal(search.references[0].id, refId);
assert.match(search.references[0].reason, /文字或标签匹配/);
assert.ok((await write(`/api/projects/${id}/items`, { inspirationIds: [refId] })).ok);
workspace = await get(`/api/projects/${id}`);
assert.equal(workspace.references[0].id, refId);
const plan = { ...emptyPlan, goal: '窗边半身', alternatives: '移至更亮的窗边', shots: [{ name: '半身', minutes: 10, instructions: '先清理画面边缘' }], referenceIds: [refId] };
assert.ok((await write(`/api/projects/${id}/plans`, { plan, brief, note: '初版' })).ok);
assert.ok((await write(`/api/projects/${id}/plans`, { plan: { ...plan, lighting: '窗侧自然光' }, brief, note: '调整光线' })).ok);
workspace = await get(`/api/projects/${id}`);
assert.deepEqual(workspace.versions.map(v => v.version), [2, 1]);
assert.equal(workspace.versions[1].plan.lighting, '', 'Earlier approved version is not overwritten');
const stale = await write(`/api/projects/${id}/plans`, { plan, brief: { ...brief, team: '独自拍摄' } });
assert.equal(stale.ok, false);
assert.equal(state.versions.length, 2);
assert.equal((await client.transport('/api/projects/missing')).status, 404);
console.log('Project adapter flow: read-only preview, confirm requirements, retrieve real IDs, associate references, append v1/v2 and stale-save failure passed against synthetic REST fixture. Live DB/UI remain unverified.');
