import { bindings, jsonError, requireApiUser } from '@/app/api-utils';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const { DB } = bindings();
    const images = await DB.prepare(
      'SELECT id, filename, position FROM inspiration_images WHERE inspiration_id = ? AND user_id = ? ORDER BY position ASC',
    ).bind(id, user.userId).all<{ id: string; filename: string; position: number }>();
    return Response.json({ images: (images.results ?? []).map((image) => ({
      ...image, url: `/api/inspirations/${id}/images/${image.id}`,
    })) });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError('暂时无法读取图片。', 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const { DB, FILES } = bindings();
    const inspiration = await DB.prepare('SELECT id, cover_key FROM inspirations WHERE id = ? AND user_id = ? LIMIT 1')
      .bind(id, user.userId).first<{ id: string; cover_key: string | null }>();
    if (!inspiration) return jsonError('没有找到这条灵感。', 404);
    const form = await request.formData();
    const files = form.getAll('images').filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length) return jsonError('请选择截图或照片。');
    if (files.length > 12 || files.reduce((sum, file) => sum + file.size, 0) > 40_000_000) {
      return jsonError('一次最多上传 12 张图片，且总大小不能超过 40 MB。');
    }
    const positionRow = await DB.prepare('SELECT MAX(position) AS max_position FROM inspiration_images WHERE inspiration_id = ? AND user_id = ?')
      .bind(id, user.userId).first<{ max_position: number | null }>();
    const now = Date.now();
    const records: Array<{ id: string; url: string; filename: string; position: number }> = [];
    const statements: D1PreparedStatement[] = [];
    let newCoverKey: string | null = inspiration.cover_key;
    let newCoverType: string | null = null;
    for (const [index, file] of files.entries()) {
      if (!file.type.startsWith('image/') || file.size > 15_000_000) continue;
      const imageId = crypto.randomUUID();
      const position = (positionRow?.max_position ?? -1) + index + 1;
      const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const key = `users/${user.userId}/inspirations/${id}/${String(position + 1).padStart(2, '0')}.${extension}`;
      await FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
      if (!newCoverKey) { newCoverKey = key; newCoverType = file.type; }
      statements.push(DB.prepare(
        `INSERT INTO inspiration_images (id, inspiration_id, user_id, storage_key, filename, content_type, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(imageId, id, user.userId, key, file.name, file.type, position, now));
      records.push({ id: imageId, filename: file.name, position, url: `/api/inspirations/${id}/images/${imageId}` });
    }
    if (!records.length) return jsonError('请选择有效的图片文件。');
    statements.push(DB.prepare(
      'UPDATE inspirations SET cover_key = COALESCE(cover_key, ?), cover_type = COALESCE(cover_type, ?), status = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    ).bind(newCoverKey, newCoverType, 'ready', now, id, user.userId));
    await DB.batch(statements);
    return Response.json({ images: records, coverUrl: `/api/inspirations/${id}/cover`, status: 'ready' }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return jsonError('图片没有上传成功，请稍后重试。', 500);
  }
}
