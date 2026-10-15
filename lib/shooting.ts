export const briefFields = {
  purpose: '用途与目标', style: '风格与情绪', subject: '主体与人数', location: '场地与场景',
  time: '日期与光线时段', equipment: '可用器材', team: '拍摄人员', constraints: '必须满足 / 不能做的事',
} as const;
export type Brief = Record<keyof typeof briefFields, string> & { durationMinutes: number };
export const emptyBrief: Brief = { purpose: '', style: '', subject: '', location: '', time: '', equipment: '', team: '', constraints: '', durationMinutes: 30 };
export const planFields = { goal: '拍摄目标', scene: '场景安排', styling: '服装与道具', lighting: '布光', composition: '构图', poses: '动作引导', schedule: '拍摄顺序', alternatives: '替代方案' } as const;
export type Plan = Record<keyof typeof planFields, string> & { shots: { name: string; minutes: number; instructions: string }[]; referenceIds: string[] };
export const emptyPlan: Plan = { goal: '', scene: '', styling: '', lighting: '', composition: '', poses: '', schedule: '', alternatives: '', shots: [], referenceIds: [] };
export type Reference = { id: string; title: string; description: string; summary: string; tags: string[]; source_url?: string | null; sourceUrl?: string | null; coverUrl?: string | null };
export type Version = { id: string; version: number; plan: Plan; brief_snapshot: Brief; created_at: number; origin: 'manual' | 'ai'; note: string };
export type Trace = { tool: string; status: 'ok' | 'error'; detail: string };
export type Proposal = { reply: string; questions: string[]; brief: Brief | null; plan: Plan | null; recommendations: { referenceId: string; reason: string }[]; trace: Trace[] };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('数据格式不正确。');
  return value as Record<string, unknown>;
}
export function parseBrief(value: unknown): Brief {
  const data = object(value);
  const output = { ...emptyBrief };
  for (const key of Object.keys(briefFields) as (keyof typeof briefFields)[]) {
    if (typeof data[key] !== 'string' || (data[key] as string).length > 2000) throw new Error('需求字段必须是 2000 字以内的文字。');
    output[key] = (data[key] as string).trim();
  }
  if (!Number.isInteger(data.durationMinutes) || Number(data.durationMinutes) < 5 || Number(data.durationMinutes) > 1440) throw new Error('拍摄时长需为 5–1440 分钟的整数。');
  output.durationMinutes = Number(data.durationMinutes);
  return output;
}
export function parsePlan(value: unknown): Plan {
  const data = object(value);
  const output = { ...emptyPlan };
  for (const key of Object.keys(planFields) as (keyof typeof planFields)[]) {
    if (typeof data[key] !== 'string' || (data[key] as string).length > 5000) throw new Error('方案字段必须是 5000 字以内的文字。');
    output[key] = (data[key] as string).trim();
  }
  if (!output.goal) throw new Error('请填写拍摄目标。');
  if (!Array.isArray(data.shots) || data.shots.length > 30) throw new Error('镜头清单最多 30 项。');
  output.shots = data.shots.map(value => {
    const shot = object(value);
    if (typeof shot.name !== 'string' || !shot.name.trim() || shot.name.length > 100 || typeof shot.instructions !== 'string' || shot.instructions.length > 2000 || !Number.isInteger(shot.minutes) || Number(shot.minutes) < 1 || Number(shot.minutes) > 1440) throw new Error('每个镜头需填写名称、说明和有效分钟数。');
    return { name: shot.name.trim(), minutes: Number(shot.minutes), instructions: shot.instructions.trim() };
  });
  if (!Array.isArray(data.referenceIds) || data.referenceIds.length > 30 || data.referenceIds.some(id => typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(id))) throw new Error('参考素材 ID 无效。');
  output.referenceIds = [...new Set(data.referenceIds)] as string[];
  return output;
}
export function missingBrief(brief: Brief) {
  return (['purpose', 'location', 'equipment', 'team'] as const).filter(key => !brief[key].trim()).map(key => `请补充${briefFields[key]}，不确定可以写“待定”。`);
}
export function checkPlan(brief: Brief, plan: Plan) {
  const warnings: string[] = [];
  const text = [...Object.keys(planFields).map(key => plan[key as keyof typeof planFields]), ...plan.shots.map(s => s.name + ' ' + s.instructions)].join('\n');
  // Conservative heuristics, not a comprehensive semantic or safety check.
  const activeText = text.split(/[。；;\n]/).filter(line => !/无需|不用|不需要|不使用|避免|不要/.test(line)).join('\n');
  if (/只有手机|仅手机|手机|iPhone/i.test(brief.equipment) && !/相机|单反|微单/.test(brief.equipment) && /更换镜头|换镜头|85mm|50mm|单反|微单/i.test(activeText)) warnings.push('器材冲突：当前填写的是手机，方案却涉及相机或更换镜头。');
  if (/独自|独拍|一个人|自拍/.test(brief.team + brief.constraints) && /助手|朋友持灯|摄影助理|助理持/.test(activeText)) warnings.push('人员冲突：独自拍摄条件下安排了助手。');
  if (/无三脚架|没有三脚架/.test(brief.equipment + brief.constraints) && /三脚架/.test(activeText)) warnings.push('器材冲突：方案需要尚未具备的三脚架。');
  if (/无灯|没有补光灯|没有闪光灯|仅自然光/.test(brief.equipment + brief.constraints) && /闪光灯|补光灯|柔光箱/.test(activeText)) warnings.push('布光冲突：方案使用了当前未提供的灯光设备。');
  const total = plan.shots.reduce((sum, shot) => sum + shot.minutes, 0);
  if (total > brief.durationMinutes) warnings.push(`时间冲突：镜头清单共 ${total} 分钟，超过可用的 ${brief.durationMinutes} 分钟。`);
  if (!plan.shots.length) warnings.push('还没有镜头清单，请补充可执行的拍摄步骤。');
  if (!plan.alternatives.trim()) warnings.push('建议补充天气、场地或光线变化时的替代方案。');
  return warnings;
}
export function rankReferences(rows: Reference[], query: string) {
  const terms = [...new Set(query.trim().toLowerCase().split(/[\s，,、]+/).filter(Boolean))].slice(0, 10);
  return rows.map(row => {
    const matched = terms.filter(term => `${row.title} ${row.description} ${row.summary} ${row.tags.join(' ')}`.toLowerCase().includes(term));
    return { ...row, score: matched.length, reason: matched.length ? `文字或标签匹配：${matched.join('、')}` : '未指定搜索条件；按收藏顺序展示' };
  }).filter(row => !terms.length || row.score > 0).sort((a, b) => b.score - a.score);
}
