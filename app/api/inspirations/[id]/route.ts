import { bindings, jsonError, requireApiUser } from '@/app/api-utils';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const body = await request.json() as { tags?: string[]; primaryTag?: string; title?: string; summary?: string };
    const tags = Array.isArray(body.tags)
      ? Array.from(new Set(body.tags.map((tag) => String(tag).trim()).filter(Boolean))).slice(0, 20)
      : null;
    const { DB } = bindings();
    const current = await DB.prepare('SELECT id FROM inspirations WHERE id = ? AND user_id = ?').bind(id, user.userId).first();
    if (!current) return jsonError('没有找到这条灵感。', 404);
    await DB.prepare(
      `UPDATE inspirations SET
       title = COALESCE(?, title), summary = COALESCE(?, summary), primary_tag = COALESCE(?, primary_tag),
       tags = COALESCE(?, tags), updated_at = ? WHERE id = ? AND user_id = ?`,
    ).bind(
      body.title?.trim().slice(0, 160) || null,
      body.summary?.trim().slice(0, 1000) || null,
      body.primaryTag?.trim().slice(0, 40) || null,
      tags ? JSON.stringify(tags) : null,
      Date.now(), id, user.userId,
    ).run();
    return Response.json({ ok: true, tags });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError('修改没有保存，请稍后重试。', 500);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const { DB, FILES } = bindings();
    const images = await DB.prepare(
      'SELECT storage_key FROM inspiration_images WHERE inspiration_id = ? AND user_id = ?',
    ).bind(id, user.userId).all<{ storage_key: string }>();
    for (const image of images.results ?? []) await FILES.delete(image.storage_key);
    await DB.batch([
      DB.prepare('DELETE FROM project_items WHERE inspiration_id = ? AND user_id = ?').bind(id, user.userId),
      DB.prepare('DELETE FROM inspiration_images WHERE inspiration_id = ? AND user_id = ?').bind(id, user.userId),
      DB.prepare('DELETE FROM inspirations WHERE id = ? AND user_id = ?').bind(id, user.userId),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError('删除失败，请稍后重试。', 500);
  }
}
