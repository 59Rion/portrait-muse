import { bindings, requireApiUser } from '@/app/api-utils';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const { DB, FILES } = bindings();
    const row = await DB.prepare(
      'SELECT cover_key, cover_type FROM inspirations WHERE id = ? AND user_id = ? LIMIT 1',
    ).bind(id, user.userId).first<{ cover_key: string | null; cover_type: string | null }>();
    if (!row?.cover_key) return new Response('Not found', { status: 404 });
    const object = await FILES.get(row.cover_key);
    if (!object) return new Response('Not found', { status: 404 });
    return new Response(object.body, {
      headers: {
        'Content-Type': row.cover_type || object.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response('Unavailable', { status: 500 });
  }
}
