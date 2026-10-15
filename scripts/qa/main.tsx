// Isolated local QA entry. Never imported by the production pages entry.
import { createRoot } from 'react-dom/client';
import { ProjectWorkspace } from '@/app/project-workspace';
import { emptyBrief, parseBrief, parsePlan, rankReferences, type Version } from '@/lib/shooting';
import '@/app/globals.css';
const references = [{ id: 'ref-a', title: '验收资料 · 窗边清冷构图', tags: ['清冷','室内'], description: '人工填写：窗边自然光半身构图', summary: '仅用于本地界面验证', coverUrl: null, sourceUrl: null }];
const workspace = { project: { id: 'qa-project', name: '窗边人像 · 本地验收演示' }, brief: { ...emptyBrief }, briefSaved: false, versions: [] as Version[], references: [] as typeof references, messages: [] };
const transport: typeof fetch = async (input, init) => {
  const path = new URL(String(input), location.origin); const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (path.pathname === '/api/agent/status') return Response.json({ enabled: false, message: '尚未配置模型。可先手动编辑需求、检索参考并保存方案。' });
  if (path.pathname === '/api/references') return Response.json({ references: rankReferences(references, path.searchParams.get('query') || '') });
  if (path.pathname.endsWith('/brief')) { workspace.brief = parseBrief(body.brief); workspace.briefSaved = true; return Response.json({ ok: true }); }
  if (path.pathname.endsWith('/plans')) { const plan = parsePlan(body.plan); const version = { id: crypto.randomUUID(), version: workspace.versions.length + 1, plan, brief_snapshot: parseBrief(body.brief), created_at: Date.now(), origin: 'manual' as const, note: body.note }; workspace.versions.unshift(version); workspace.references = references.filter(r => plan.referenceIds.includes(r.id)); return Response.json({ version }); }
  if (path.pathname.endsWith('/items')) { workspace.references = references.filter(r => body.inspirationIds.includes(r.id)); return Response.json({ ok: true }); }
  return Response.json(workspace);
};
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 1200, padding: '12px 18px 60px', margin: 'auto' }}><div className="studio-notice">本地验收演示 · 所有资料均为合成测试文字，不是真实收藏。保存仅写入本页临时内存，刷新即清除，不连接线上账号或模型。</div><ProjectWorkspace projectId="qa-project" transport={transport} onBack={() => alert('本地验收入口，不连接真实项目列表。')} onChanged={() => undefined} /></main>);
