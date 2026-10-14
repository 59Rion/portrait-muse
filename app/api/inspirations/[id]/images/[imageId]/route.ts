import { bindings, requireApiUser } from '@/app/api-utils';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string; imageId: string }> }) {
  try {
    const user = await requireApiUser();
    const { id, imageId } = await context.params;
    const { DB, FILES } = bindings();
    const row = await DB.prepare(
      'SELECT storage_key, content_type FROM inspiration_images WHERE id = ? AND inspiration_id = ? AND user_id = ? LIMIT 1',
    ).bind(imageId, id, user.userId).first<{ storage_key: string; content_type: string }>();
    if (!row) return new Response('Not found', { status: 404 });
    const object = await FILES.get(row.storage_key);
    if (!object) return new Response('Not found', { status: 404 });
    return new Response(object.body, { headers: {
      'Content-Type': row.content_type || object.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response('Unavailable', { status: 500 });
  }
}
