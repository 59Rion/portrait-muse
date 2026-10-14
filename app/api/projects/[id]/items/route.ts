import { bindings, jsonError, requireApiUser } from '@/app/api-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id: projectId } = await context.params;
    const body = await request.json() as { inspirationId?: string };
    if (!body.inspirationId) return jsonError('请选择一条灵感。');
    const { DB } = bindings();
    const project = await DB.prepare('SELECT id FROM shoot_projects WHERE id = ? AND user_id = ?').bind(projectId, user.userId).first();
    const inspiration = await DB.prepare('SELECT id FROM inspirations WHERE id = ? AND user_id = ?').bind(body.inspirationId, user.userId).first();
    if (!project || !inspiration) return jsonError('项目或灵感不存在。', 404);
    await DB.prepare(
      'INSERT OR IGNORE INTO project_items (id, project_id, inspiration_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), projectId, body.inspirationId, user.userId, Date.now()).run();
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError('暂时无法加入项目。', 500);
  }
}
