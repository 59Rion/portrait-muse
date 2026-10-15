'use client';
import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Check, Cloud, ExternalLink, LoaderCircle, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { briefFields, planFields, emptyBrief, emptyPlan, parseBrief, parsePlan, missingBrief, checkPlan, type Brief, type Plan, type Proposal, type Reference, type Version } from '@/lib/shooting';
import './project-workspace.css';

type RefCard = Reference & { reason?: string; coverUrl?: string | null };
type HistoryMessage = { id: string; role: string; content: string; created_at: number; detail?: Proposal & { failed?: boolean } };
type Workspace = { project: { id: string; name: string }; brief: Brief; briefSaved: boolean; versions: Version[]; references: RefCard[]; messages: HistoryMessage[] };
type Confirmation = { kind: 'brief'; brief: Brief } | { kind: 'plan'; plan: Plan; brief: Brief; origin: 'manual' | 'ai'; note: string } | { kind: 'references'; ids: string[] };
const tabs = { brief: '拍摄需求', references: '参考素材', plan: '执行方案', history: '修改记录' } as const;
const toolNames: Record<string, string> = { get_project_details: '读取项目', search_references: '检索资料库', get_reference_details: '读取参考', save_shooting_plan: '提出方案草稿', add_project_references: '提出参考关联', present_result: '返回待确认结果', check_constraints: '检查约束' };
const sameBrief = (a: Brief, b: Brief) => JSON.stringify(parseBrief(a)) === JSON.stringify(parseBrief(b));

export function ProjectWorkspace({ projectId, transport, onBack, onChanged }: { projectId: string; transport: typeof fetch; onBack: () => void; onChanged: () => void }) {
  const [data, setData] = useState<Workspace | null>(null);
  const [tab, setTab] = useState<keyof typeof tabs>('brief');
  const [brief, setBrief] = useState<Brief>({ ...emptyBrief });
  const [plan, setPlan] = useState<Plan>({ ...emptyPlan, shots: [], referenceIds: [] });
  const [origin, setOrigin] = useState<'manual' | 'ai'>('manual');
  const [note, setNote] = useState('');
  const [feedback, setFeedback] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RefCard[]>([]);
  const [sources, setSources] = useState<RefCard[]>([]);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [model, setModel] = useState<{ enabled: boolean; provider?: string; message: string }>({ enabled: false, message: '正在检查模型连接…' });
  const [consent, setConsent] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  async function api(path: string, body?: unknown, method = 'POST'): Promise<any> {
    const response = await transport(path, body === undefined ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json() as Record<string, any>;
    if (!response.ok) throw new Error(value.error || '操作失败，请稍后重试。');
    return value;
  }
  async function reload() {
    const value = await api(`/api/projects/${projectId}`) as Workspace;
    value.brief = parseBrief(value.brief);
    setData(value);
    return value;
  }
  useEffect(() => {
    let alive = true;
    void api(`/api/projects/${projectId}`).then((value: Workspace) => {
      if (!alive) return;
      value.brief = parseBrief(value.brief);
      setData(value); setBrief(value.brief);
      if (value.versions[0]) setPlan(parsePlan(value.versions[0].plan));
    }).catch(e => alive && setMessage(e.message)).finally(() => alive && setLoading(false));
    void api('/api/agent/status').then(value => alive && setModel(value)).catch(() => alive && setModel({ enabled: false, message: '模型服务未连接。你仍可手动编辑并保存方案。' }));
    return () => { alive = false; };
  }, [projectId]);
  const briefDirty = data ? !data.briefSaved || !sameBrief(brief, data.brief) : false;
  const warnings = checkPlan(brief, plan);
  const refs = [...(data?.references || []), ...results, ...sources].filter((r, index, all) => all.findIndex(other => other.id === r.id) === index);
  const names = (ids: string[]) => ids.map(id => refs.find(r => r.id === id)?.title || `已移除或未加载素材（${id}）`);
  function previewPlan() {
    try {
      if (briefDirty) throw new Error('请先确认保存拍摄需求，再保存方案。');
      setAcknowledged(false);
      setConfirmation({ kind: 'plan', plan: parsePlan(plan), brief: parseBrief(brief), origin, note });
    } catch (e) { setMessage((e as Error).message); }
  }
  async function confirm() {
    if (!confirmation) return;
    setBusy(true); setMessage(''); setConfirmError('');
    try {
      if (confirmation.kind === 'brief') {
        await api(`/api/projects/${projectId}/brief`, { brief: confirmation.brief }, 'PUT');
        setMessage('需求摘要已保存。已有方案不会自动改变，请复核后另存新版本。');
      } else if (confirmation.kind === 'plan') {
        await api(`/api/projects/${projectId}/plans`, confirmation);
        setMessage('已保存新的方案版本，并关联所引用的素材。旧版本保持不变。');
      } else {
        await api(`/api/projects/${projectId}/items`, { inspirationIds: confirmation.ids });
        setCheckedIds([]); setMessage('已确认将所选参考加入项目。');
      }
      setConfirmation(null); await reload(); onChanged();
    } catch (e) { setMessage((e as Error).message); setConfirmError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function search() {
    setBusy(true); setMessage('');
    try { const value = await api(`/api/references?query=${encodeURIComponent(query)}`); setResults(value.references); if (!value.references.length) setMessage('没有找到文字或标签匹配的收藏。可换关键词，或先补充资料。'); }
    catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  async function ask() {
    if (briefDirty) { setMessage('请先确认保存需求，助手才会读取到本次条件。'); return; }
    setBusy(true); setMessage('');
    try {
      const value = await api('/api/agent/turn', { projectId, message: feedback, draftPlan: plan, consent }) as Proposal;
      setProposal(value); setFeedback('');
      const ids = [...new Set([...(value.plan?.referenceIds || []), ...value.recommendations.map(r => r.referenceId)])];
      if (ids.length) {
        const detail = await api(`/api/references?ids=${encodeURIComponent(ids.join(','))}`);
        setSources(detail.references);
      }
      await reload();
    } catch (e) { setMessage((e as Error).message); await reload().catch(() => undefined); }
    finally { setBusy(false); }
  }
  function changePlan<K extends keyof Plan>(key: K, value: Plan[K]) { setPlan(current => ({ ...current, [key]: value })); }
  if (loading) return <section className="page-section"><p role="status"><LoaderCircle className="animate-spin" />正在读取项目…</p></section>;
  if (!data) return <section className="page-section"><Button onClick={onBack}><ArrowLeft />返回项目</Button><p role="alert">{message || '项目不可用。'}</p></section>;
  const latest = data.versions[0];
  const changedConditions = latest && !sameBrief(brief, latest.brief_snapshot);
  const confirmWarnings = confirmation?.kind === 'plan' ? checkPlan(confirmation.brief, confirmation.plan) : [];
  return <section className="page-section shooting-workspace">
    <Button variant="ghost" onClick={() => {
      const unsaved = briefDirty || JSON.stringify(plan) !== JSON.stringify(latest ? parsePlan(latest.plan) : emptyPlan);
      if (!unsaved || window.confirm('当前编辑草稿尚未保存，确定返回项目列表吗？')) onBack();
    }}><ArrowLeft />拍摄项目</Button>
    <header className="shooting-heading"><div><p className="eyebrow">从目标到现场 · PROJECT STUDIO</p><h1>{data.project.name}</h1><p>先明确条件，再组织参考，把想法变成可以执行的拍摄清单。</p></div><span className="studio-badge"><BookOpen />{data.versions.length ? `最新 v${latest.version}` : '尚无保存方案'}</span></header>
    {message && <div className="studio-notice" role="status">{message}</div>}
    <nav className="studio-tabs" aria-label="项目详情导航">{Object.entries(tabs).map(([key, title]) => <button key={key} aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'active' : ''} onClick={() => setTab(key as keyof typeof tabs)}>{title}{key === 'references' && ` · ${data.references.length}`}</button>)}</nav>
    <div className="studio-layout"><div className="studio-main">
      {tab === 'brief' && <article className="studio-panel">
        <div className="studio-panel-heading"><h2>拍摄需求摘要</h2><span>{briefDirty ? '未保存的草稿' : '已确认保存'}</span></div>
        <p className="studio-hint">不确定的条件可填“待定”，不要让助手替你假定器材或人员。</p>
        <div className="studio-form-grid">{Object.entries(briefFields).map(([key, label]) => <label key={key}>{label}<Textarea maxLength={2000} value={brief[key as keyof typeof briefFields]} placeholder={key === 'equipment' ? '例如：仅 iPhone，没有三脚架' : key === 'team' ? '例如：独自拍摄 / 朋友帮拍' : key === 'constraints' ? '例如：不能用闪光灯、不换场地' : '请填写；不确定可写待定'} onChange={e => setBrief(current => ({ ...current, [key]: e.target.value }))} /></label>)}<label>可用拍摄时长（分钟）<Input type="number" min={5} max={1440} value={brief.durationMinutes} onChange={e => setBrief(current => ({ ...current, durationMinutes: Number(e.target.value) }))} /></label></div>
        {missingBrief(brief).length > 0 && <div className="studio-checks"><strong>还需确认的关键条件</strong>{missingBrief(brief).map(q => <p key={q}>{q}</p>)}</div>}
        <Button disabled={busy || !briefDirty} onClick={() => { try { setConfirmation({ kind: 'brief', brief: parseBrief(brief) }); } catch (e) { setMessage((e as Error).message); } }}><Check />预览并保存需求</Button>
      </article>}
      {tab === 'references' && <article className="studio-panel">
        <h2>本次拍摄的真实参考</h2><p className="studio-hint">只检索当前账号的标题、文字与标签。未分析图片，也不会自动读取链接中的正文。最多检索最近 500 条收藏，展示前 60 条。</p>
        <form className="studio-search" onSubmit={e => { e.preventDefault(); void search(); }}><Input aria-label="参考关键词" placeholder="用空格分隔，例如：清冷 室内 自然光" value={query} onChange={e => setQuery(e.target.value)} /><Button disabled={busy}><Search />检索</Button></form>
        <h3>已关联 · {data.references.length}</h3>{data.references.length ? <div className="studio-ref-grid">{data.references.map(r => <ReferenceCard key={r.id} item={r} />)}</div> : <p className="studio-hint">还没有参考。可以从下方检索，也可以在灵感库中加入项目。</p>}
        {results.length > 0 && <><h3>文字检索结果（不是 AI 推荐）</h3><div className="studio-ref-grid">{results.map(r => <ReferenceCard key={r.id} item={r} selected={checkedIds.includes(r.id)} onToggle={() => setCheckedIds(ids => ids.includes(r.id) ? ids.filter(id => id !== r.id) : [...ids, r.id].slice(0, 30))} />)}</div><Button disabled={!checkedIds.length || busy} onClick={() => setConfirmation({ kind: 'references', ids: [...checkedIds] })}><Plus />预览加入项目 · {checkedIds.length}</Button></>}
      </article>}
      {tab === 'plan' && <article className="studio-panel">
        <div className="studio-panel-heading"><h2>可执行拍摄方案</h2><span>{origin === 'ai' ? 'AI 草稿 · 可编辑' : '手动编辑'}</span></div>
        <p className="studio-hint">这里的输入是编辑草稿。只有点击预览并确认后，才会创建新版本。</p>
        {changedConditions && <div className="studio-notice">当前需求与已存方案的条件不同，请复核受影响的步骤。旧版本保留原始需求快照。</div>}
        <div className="studio-form-grid">{Object.entries(planFields).map(([key, label]) => <label key={key}>{label}<Textarea maxLength={5000} value={plan[key as keyof typeof planFields]} onChange={e => changePlan(key as keyof typeof planFields, e.target.value)} /></label>)}</div>
        <h3>镜头清单 <small>{plan.shots.reduce((sum, shot) => sum + shot.minutes, 0)} / {brief.durationMinutes} 分钟</small></h3>
        {plan.shots.map((shot, index) => <div className="studio-shot" key={index}><span>{String(index + 1).padStart(2, '0')}</span><label>镜头名称<Input maxLength={100} value={shot.name} onChange={e => changePlan('shots', plan.shots.map((s, i) => i === index ? { ...s, name: e.target.value } : s))} /></label><label>分钟<Input type="number" min={1} max={1440} value={shot.minutes} onChange={e => changePlan('shots', plan.shots.map((s, i) => i === index ? { ...s, minutes: Number(e.target.value) } : s))} /></label><Button variant="ghost" aria-label={`移除镜头${index + 1}`} onClick={() => changePlan('shots', plan.shots.filter((_, i) => i !== index))}><Trash2 /></Button><label className="shot-instructions">动作、构图与执行提示<Textarea maxLength={2000} value={shot.instructions} onChange={e => changePlan('shots', plan.shots.map((s, i) => i === index ? { ...s, instructions: e.target.value } : s))} /></label></div>)}
        <Button variant="outline" disabled={plan.shots.length >= 30} onClick={() => changePlan('shots', [...plan.shots, { name: '', minutes: 5, instructions: '' }])}><Plus />添加镜头</Button>
        <h3>方案引用</h3>{refs.length ? <div className="studio-ref-choices">{refs.map(r => <label key={r.id}><input type="checkbox" checked={plan.referenceIds.includes(r.id)} onChange={e => changePlan('referenceIds', e.target.checked ? [...plan.referenceIds, r.id].slice(0, 30) : plan.referenceIds.filter(id => id !== r.id))} />{r.title}</label>)}</div> : <p className="studio-hint">先在“参考素材”中检索或关联真实资料，也可以保存无引用的原创方案。</p>}
        {plan.referenceIds.filter(id => !refs.some(r => r.id === id)).map(id => <div className="studio-notice" key={id}>引用已移除或尚未加载：{id}<button onClick={() => changePlan('referenceIds', plan.referenceIds.filter(value => value !== id))}>移除此引用</button></div>)}
        <div className="studio-checks"><strong>基础约束检查</strong>{warnings.length ? warnings.map(w => <p key={w}>{w}</p>) : <p>规则检查未发现明显冲突。此检查不是完整语义或安全审查，现场仍需人工复核。</p>}</div>
        <label className="studio-field">本次修改说明<Input maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="例如：改为室内拍摄，保留原构图" /></label>
        <Button disabled={busy} onClick={previewPlan}><Check />预览并保存新版本</Button>
      </article>}
      {tab === 'history' && <article className="studio-panel"><h2>方案与修改记录</h2><p className="studio-hint">已保存版本只读。载入旧版只是填入编辑器，确认保存才会生成新版本。最多显示最近 100 个方案版本和 50 条对话。</p>
        {data.versions.length ? data.versions.map(v => <details className="studio-version" key={v.id}><summary><span>v{v.version} · {v.plan.goal}</span><small>{new Date(v.created_at).toLocaleString('zh-CN')}</small></summary><p>{v.note || '未填写修改说明'}</p><p>{v.origin === 'ai' ? '来自 AI 草稿（经用户确认）' : '手动方案'}</p><h3>该版需求快照</h3>{Object.entries(briefFields).map(([k, title]) => <p key={k}><strong>{title}：</strong>{v.brief_snapshot[k as keyof typeof briefFields] || '未填写'}</p>)}<h3>方案内容</h3>{Object.entries(planFields).map(([k, title]) => <p key={k}><strong>{title}：</strong>{v.plan[k as keyof typeof planFields] || '未填写'}</p>)}{v.plan.shots.map((s, i) => <p key={i}>{i + 1}. {s.name} · {s.minutes} 分钟 — {s.instructions}</p>)}<Button variant="outline" onClick={() => { if (window.confirm('将此版本载入当前编辑器？尚未保存的方案草稿会被替换，但不会覆盖任何已存版本。')) { setPlan(parsePlan(v.plan)); setOrigin('manual'); setNote(`基于 v${v.version} 修改`); setTab('plan'); } }}>载入为编辑草稿</Button></details>) : <p>尚无已确认保存的方案。</p>}
        <h3>项目对话</h3>{data.messages.length ? data.messages.map(m => <div className="studio-history-message" key={m.id}><small>{m.role === 'user' ? '你' : '拍摄助手'} · {new Date(m.created_at).toLocaleString('zh-CN')}</small><p>{m.content}</p>{m.role === 'assistant' && m.detail?.reply && <Button variant="outline" onClick={() => { setProposal(m.detail!); setMessage('已打开历史回复；其中的草稿可能不符合最新条件，请复核。'); }}>查看这次回复与执行记录</Button>}</div>) : <p className="studio-hint">模型接通后，项目对话会在这里保留。</p>}
      </article>}
    </div><aside className="studio-assistant studio-panel">
      <div className="studio-panel-heading"><h2><Sparkles />拍摄助手</h2><span className={model.enabled ? 'model-ready' : ''}>{model.enabled ? '已连接' : '未配置模型'}</span></div>
      <p className="studio-hint">{model.message}</p>
      <Textarea aria-label="给拍摄助手的需求" maxLength={6000} value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="例如：帮我找适合这次拍摄的参考；没有三脚架，改成朋友用手机帮拍。" />
      {model.enabled && <label className="studio-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />同意将本项目需求、近期对话、方案草稿和检索到的收藏文字发送给 {model.provider}；不发送图片文件。</label>}
      <Button disabled={!model.enabled || !consent || !feedback.trim() || busy || briefDirty} onClick={() => void ask()}>{busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}分析 / 修改方案</Button>
      {briefDirty && <p className="studio-hint">先确认保存左侧需求摘要，再让助手读取项目。</p>}
      <p className="studio-hint">助手只能提出草稿；方案和参考关联必须经你预览确认。不提供图片识别、外站正文读取或联网搜索。</p>
      {proposal && <div className="studio-proposal"><h3>助手回复 · 尚未修改项目</h3><p>{proposal.reply}</p>{proposal.questions.map(q => <p key={q}>• {q}</p>)}
        {proposal.brief && <details><summary>查看建议的需求摘要</summary>{Object.entries(briefFields).map(([k, title]) => <p key={k}>{title}：{proposal.brief![k as keyof typeof briefFields] || '待补充'}</p>)}<Button variant="outline" onClick={() => { setBrief(parseBrief(proposal.brief)); setTab('brief'); setMessage('建议已填入需求编辑器，尚未保存，请复核。'); }}>载入需求草稿</Button></details>}
        {proposal.plan && <details><summary>查看建议的完整方案</summary>{Object.entries(planFields).map(([k, title]) => <p key={k}>{title}：{proposal.plan![k as keyof typeof planFields]}</p>)}{proposal.plan.shots.map((s, i) => <p key={i}>{s.name} · {s.minutes} 分钟：{s.instructions}</p>)}<Button variant="outline" onClick={() => { setPlan(parsePlan(proposal.plan)); setOrigin('ai'); setTab('plan'); setMessage('AI 草稿已填入方案编辑器，尚未保存，请复核条件、镜头和引用。'); }}>载入方案草稿</Button></details>}
        {proposal.recommendations.map(r => <div className="studio-recommendation" key={r.referenceId}><strong>{refs.find(ref => ref.id === r.referenceId)?.title || `素材 ${r.referenceId}`}</strong><p>{r.reason}</p><small>依据已读取的文字与标签，不代表视觉分析。</small><Button variant="outline" onClick={() => setConfirmation({ kind: 'references', ids: [r.referenceId] })}>预览加入参考</Button></div>)}
        <details><summary>简明执行记录</summary>{proposal.trace.map((step, i) => <p key={i}>{step.status === 'error' ? '未完成' : '完成'} · {toolNames[step.tool] || step.tool}：{step.detail}</p>)}</details>
      </div>}
    </aside></div>
    <Dialog open={Boolean(confirmation)} onOpenChange={open => !busy && !open && setConfirmation(null)}><DialogContent className="studio-confirm-dialog"><DialogHeader><DialogTitle>{confirmation?.kind === 'brief' ? '确认保存需求摘要' : confirmation?.kind === 'references' ? '确认关联参考素材' : '确认保存方案新版本'}</DialogTitle><DialogDescription>以下内容仅在你点击确认后写入当前项目；旧方案版本不会被覆盖。</DialogDescription></DialogHeader>
      {confirmError && <p className="studio-notice" role="alert">{confirmError}</p>}
      <div className="studio-confirm-body">
        {confirmation?.kind === 'brief' && <>{Object.entries(briefFields).map(([k, title]) => <p key={k}><strong>{title}：</strong>{confirmation.brief[k as keyof typeof briefFields] || '未填写'}</p>)}<p>拍摄时长：{confirmation.brief.durationMinutes} 分钟</p></>}
        {confirmation?.kind === 'references' && names(confirmation.ids).map((title, i) => <p key={i}>{title}</p>)}
        {confirmation?.kind === 'plan' && <>{Object.entries(planFields).map(([k, title]) => <p key={k}><strong>{title}：</strong>{confirmation.plan[k as keyof typeof planFields] || '未填写'}</p>)}{confirmation.plan.shots.map((s, i) => <p key={i}>{i + 1}. {s.name} · {s.minutes} 分钟：{s.instructions}</p>)}<p><strong>将同时关联的参考：</strong>{names(confirmation.plan.referenceIds).join('；') || '无'}</p><p>修改说明：{confirmation.note || '无'}</p>{confirmWarnings.length > 0 && <div className="studio-checks">{confirmWarnings.map(w => <p key={w}>{w}</p>)}<label><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />我已查看以上提示，仍确认保存此版本</label></div>}</>}
      </div><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>取消</Button><Button disabled={busy || (confirmWarnings.length > 0 && !acknowledged)} onClick={() => void confirm()}>{busy ? '保存中…' : '确认保存'}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}

function ReferenceCard({ item, selected, onToggle }: { item: RefCard; selected?: boolean; onToggle?: () => void }) {
  const url = item.sourceUrl || item.source_url;
  return <article className="studio-reference">{item.coverUrl ? <img src={item.coverUrl} alt={item.title} /> : <div className="studio-ref-placeholder"><Cloud /><span>仅保存链接 / 文字</span></div>}<div>{onToggle && <label className="studio-consent"><input type="checkbox" checked={selected} onChange={onToggle} />选择参考</label>}<h4>{item.title}</h4><p>{item.reason || item.description || '没有可读取的描述，不能推断图片内容。'}</p><small>{item.tags.map(t => `#${t}`).join(' ')}</small>{url && /^https:\/\//i.test(url) && <a href={url} target="_blank" rel="noreferrer">查看原始来源 <ExternalLink /></a>}</div></article>;
}
