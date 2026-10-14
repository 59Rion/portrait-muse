import { bindings, jsonError, requireApiUser, safeJsonArray } from '@/app/api-utils';

export const dynamic = 'force-dynamic';

const starterTags = ['人像', '相机参考', '自然光', '韩系', '少女', '氛围感', '清冷', '复古'];

export async function GET() {
  try {
    const user = await requireApiUser();
    const { DB } = bindings();
    let result = await DB.prepare('SELECT name FROM user_tags WHERE user_id = ? ORDER BY created_at ASC').bind(user.userId).all<{ name: string }>();
    if (!(result.results ?? []).length) {
      const now = Date.now();
      await DB.batch(starterTags.map((name, index) => DB.prepare(
        'INSERT OR IGNORE INTO user_tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), user.userId, name, now + index)));
      result = await DB.prepare('SELECT name FROM user_tags WHERE user_id = ? ORDER BY created_at ASC').bind(user.userId).all<{ name: string }>();
    }
    return Response.json({ tags: (result.results ?? []).map((row) => row.name) });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError('暂时无法读取标签。', 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const { name } = await request.json() as { name?: string };
    const cleanName = String(name ?? '').trim().slice(0, 30);
    if (!cleanName) return jsonError('请输入标签名称。');
    const { DB } = bindings();
    await DB.prepare('INSERT OR IGNORE INTO user_tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), user.userId, cleanName, Date.now()).run();
    return Response.json({ name: cleanName }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError('标签没有添加成功。', 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser();
    const body = await request.json() as { oldName?: string; newName?: string };
    const oldName = String(body.oldName ?? '').trim();
    const newName = String(body.newName ?? '').trim().slice(0, 30);
    if (!oldName || !newName) return jsonError('请输入原标签和新标签。');
    const { DB } = bindings();
    const rows = await DB.prepare('SELECT id, tags, primary_tag FROM inspirations WHERE user_id = ?').bind(user.userId)
      .all<{ id: string; tags: string; primary_tag: string }>();
    const statements = [
      DB.prepare('INSERT OR IGNORE INTO user_tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)')
        .bind(crypto.randomUUID(), user.userId, newName, Date.now()),
      DB.prepare('DELETE FROM user_tags WHERE user_id = ? AND name = ?').bind(user.userId, oldName),
    ];
    for (const row of rows.results ?? []) {
      const tags = Array.from(new Set(safeJsonArray(row.tags).map((tag) => tag === oldName ? newName : tag)));
      statements.push(DB.prepare('UPDATE inspirations SET tags = ?, primary_tag = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(JSON.stringify(tags), row.primary_tag === oldName ? newName : row.primary_tag, Date.now(), row.id, user.userId));
    }
    await DB.batch(statements);
    return Response.json({ oldName, newName });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError('标签没有改名成功。', 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const name = String(url.searchParams.get('name') ?? '').trim();
    if (!name) return jsonError('请选择要删除的标签。');
    const { DB } = bindings();
    const rows = await DB.prepare('SELECT id, tags, primary_tag FROM inspirations WHERE user_id = ?').bind(user.userId)
      .all<{ id: string; tags: string; primary_tag: string }>();
    const statements = [DB.prepare('DELETE FROM user_tags WHERE user_id = ? AND name = ?').bind(user.userId, name)];
    for (const row of rows.results ?? []) {
      const tags = safeJsonArray(row.tags).filter((tag) => tag !== name);
      const primaryTag = row.primary_tag === name ? (tags[0] || '人像') : row.primary_tag;
      statements.push(DB.prepare('UPDATE inspirations SET tags = ?, primary_tag = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(JSON.stringify(tags), primaryTag, Date.now(), row.id, user.userId));
    }
    await DB.batch(statements);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError('标签没有删除成功。', 500);
  }
}
