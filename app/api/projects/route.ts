import { bindings, jsonError, requireApiUser } from '@/app/api-utils';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireApiUser();
    const { DB } = bindings();
    const result = await DB.prepare(
      `SELECT p.id, p.name, p.description, p.created_at, COUNT(pi.id) AS item_count
       FROM shoot_projects p LEFT JOIN project_items pi ON pi.project_id = p.id
       WHERE p.user_id = ? GROUP BY p.id ORDER BY p.created_at DESC`,
    ).bind(user.userId).all();
    return Response.json({ projects: result.results ?? [] });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError('暂时无法读取拍摄项目。', 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const body = await request.json() as { name?: string; description?: string };
    const name = body.name?.trim();
    if (!name) return jsonError('请输入项目名称。');
    const id = crypto.randomUUID();
    const now = Date.now();
    const { DB } = bindings();
    await DB.prepare(
      'INSERT INTO shoot_projects (id, user_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(id, user.userId, name.slice(0, 100), (body.description ?? '').slice(0, 1000), now).run();
    return Response.json({ project: { id, name, description: body.description ?? '', created_at: now, item_count: 0 } }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError('项目创建失败，请稍后重试。', 500);
  }
}
