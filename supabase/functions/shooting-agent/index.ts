import { runAgent, type Driver } from '../_shared/agent.ts';
import { emptyBrief, rankReferences, type Reference } from '../../../lib/shooting.ts';

// User JWT is verified by Auth before any project access. No admin/service_role client.
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };
const allowedOrigin = 'https://59rion.github.io';
const cors = { 'Access-Control-Allow-Origin': allowedOrigin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: cors });
function referenceText(row: Reference) {
  return { id: row.id, title: String(row.title).slice(0, 160), description: String(row.description || '').slice(0, 2000), summary: String(row.summary || '').slice(0, 1000), tags: row.tags.slice(0, 30), source_url: row.source_url || null, contentScope: '文字最多展示2000字，未读取外站正文或分析图片。' };
}
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
  const base = Deno.env.get('SUPABASE_URL') || '';
  const publicKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
  const key = publicKeys.default || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json({ error: '请先登录。' }, 401);
  const headers = { apikey: key, Authorization: authorization, 'Content-Type': 'application/json' };
  const auth = await fetch(`${base}/auth/v1/user`, { headers, signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!auth?.ok) return json({ error: '登录状态无效，请重新登录。' }, 401);
  const user = await auth.json() as { id: string };
  const endpoint = Deno.env.get('MODEL_CHAT_COMPLETIONS_URL');
  const modelKey = Deno.env.get('MODEL_API_KEY');
  const model = Deno.env.get('MODEL_NAME');
  const provider = Deno.env.get('MODEL_PROVIDER_LABEL') || '';
  const enabled = Boolean(endpoint && modelKey && model && provider);
  if (request.method === 'GET') return json({ enabled, provider: enabled ? provider : null, message: enabled ? '模型仅接收你确认发送的项目文字与检索结果，不发送图片。' : '尚未配置模型。可先手动编辑需求、检索参考并保存方案。' });
  if (!enabled) return json({ error: 'AI 模型尚未配置；未生成或保存任何 AI 方案。请先手动编辑，稍后由管理员配置模型。', code: 'MODEL_NOT_CONFIGURED' }, 503);
  if (request.headers.get('Origin') && request.headers.get('Origin') !== allowedOrigin) return json({ error: 'Origin not allowed' }, 403);
  let userMessageSaved = false;
  let projectId = '';
  async function rest(path: string, init: RequestInit = {}): Promise<any> {
    const response = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...headers, Prefer: 'return=representation', ...init.headers }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { message?: string } | null;
      if (detail?.message?.startsWith('请求过于频繁')) throw new Error(detail.message);
      throw new Error('项目读取或操作失败。请检查访问权限，或稍后重试。');
    }
    return response.json();
  }
  try {
    if (Number(request.headers.get('Content-Length') || 0) > 100000) return json({ error: '请求内容过长。' }, 413);
    const raw = await request.text();
    if (raw.length > 100000) return json({ error: '请求内容过长。' }, 413);
    const input = JSON.parse(raw);
    if (typeof input.projectId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.projectId) || typeof input.message !== 'string' || !input.message.trim() || input.message.length > 6000 || input.consent !== true) return json({ error: '请选择项目，填写 6000 字以内需求，并确认向模型发送项目文字。' }, 400);
    projectId = input.projectId;
    const [project] = await rest(`shoot_projects?id=eq.${projectId}&select=id,name,description`);
    if (!project) return json({ error: '项目不存在或无权访问。' }, 404);
    // DB-backed rate limiting prevents concurrent invocations from multiplying model cost.
    await rest('rpc/claim_shooting_agent_turn', { method: 'POST', body: JSON.stringify({ p_project: projectId, p_content: input.message }) });
    userMessageSaved = true;
    const driver: Driver = async (messages, tools) => {
      const target = new URL(endpoint!);
      if (target.protocol !== 'https:' || target.username || target.password) throw new Error('模型服务地址配置不正确。');
      const response = await fetch(target, { method: 'POST', headers: { Authorization: `Bearer ${modelKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', parallel_tool_calls: false, max_completion_tokens: 6000 }), signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error('模型调用失败或超时，请稍后重试。项目内容尚未修改。');
      const data = await response.json() as { choices?: { finish_reason?: string; message?: Awaited<ReturnType<Driver>> }[] };
      const result = data.choices?.[0]?.message;
      if (!result || data.choices?.[0]?.finish_reason === 'length') throw new Error('模型返回不完整，请缩小需求后重试。');
      return result;
    };
    const started = Date.now();
    const proposal = await runAgent(async (...args) => {
      if (Date.now() - started > 100000) throw new Error('本轮已超时，请缩小需求后重试。');
      return driver(...args);
    }, {
      project: async () => {
        const [briefs, plans, messages, members] = await Promise.all([
          rest(`project_briefs?project_id=eq.${projectId}&select=data`),
          rest(`shooting_plans?project_id=eq.${projectId}&select=version,plan,brief_snapshot,note&order=version.desc&limit=1`),
          rest(`project_messages?project_id=eq.${projectId}&select=role,content&order=created_at.desc&limit=10`),
          rest(`project_items?project_id=eq.${projectId}&select=inspiration_id&limit=100`),
        ]);
        return { project, brief: briefs[0]?.data || emptyBrief, latestPlan: plans[0] || null, messages: messages.reverse(), references: members, contentScope: '只有文字与标签；未分析图片或读取外站正文。' };
      },
      search: async query => rankReferences(await rest('inspirations?select=id,title,description,summary,tags,source_url&order=created_at.desc&limit=500') as Reference[], query).slice(0, 12).map(row => ({ ...referenceText(row), reason: row.reason })),
      detail: async id => {
        if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
        const rows = await rest(`inspirations?id=eq.${id}&select=id,title,description,summary,tags,source_url`);
        return rows[0] ? referenceText(rows[0]) : null;
      },
    }, { message: input.message, draftPlan: input.draftPlan });
    await rest('project_messages', { method: 'POST', body: JSON.stringify({ project_id: projectId, user_id: user.id, role: 'assistant', content: proposal.reply, detail: proposal }) });
    return json(proposal);
  } catch (error) {
    const message = error instanceof Error ? error.message : '助手暂时无法完成本轮任务。';
    if (userMessageSaved) await rest('project_messages', { method: 'POST', body: JSON.stringify({ project_id: projectId, user_id: user.id, role: 'assistant', content: message, detail: { failed: true } }) }).catch(() => undefined);
    return json({ error: message, projectUnchanged: true }, 400);
  }
});
