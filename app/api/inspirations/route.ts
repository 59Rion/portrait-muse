import { classifyPortrait, bindings, extractFirstUrl, isSupportedSourceUrl, jsonError, requireApiUser, safeJsonArray } from '@/app/api-utils';
import { queryXhsDownloader } from '@/app/xhs-downloader';

export const dynamic = 'force-dynamic';

type InspirationRow = {
  id: string;
  source_url: string | null;
  title: string;
  description: string;
  summary: string;
  primary_tag: string;
  tags: string;
  status: string;
  cover_key: string | null;
  created_at: number;
};

function decodeHtml(value: string) {
  return value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u002F/g, '/')
    .replace(/\s*<!--[\s\S]*?-->\s*/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractXiaohongshuPage(html: string) {
  const meta = (property: string) => {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const first = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'));
    const second = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'));
    return decodeHtml(first?.[1] ?? second?.[1] ?? '');
  };

  const mobileTitle = html.match(/class=["'][^"']*\btitle\b[^"']*title-no-padding-top[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  const mobileDescription = html.match(/class=["'][^"']*note-desc-text-opt[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*(?:<!---->)?\s*<div class=["'][^"']*topic-container/i)?.[1];
  const title = meta('og:title') || decodeHtml(mobileTitle ?? '');
  const description = meta('description') || meta('og:description') || decodeHtml(mobileDescription ?? '');

  const imageUrls: string[] = [];
  for (const match of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*\bdata-xhs-img\b[^>]*>/gi)) {
    const normalized = decodeHtml(match[1]).replace(/^http:\/\//i, 'https://');
    if (normalized && !imageUrls.includes(normalized)) imageUrls.push(normalized);
  }
  const metaImage = meta('og:image').replace(/^http:\/\//i, 'https://');
  if (metaImage && !imageUrls.includes(metaImage)) imageUrls.unshift(metaImage);
  return { title, description, imageUrls: imageUrls.slice(0, 12) };
}

function toRecord(row: InspirationRow) {
  return {
    id: row.id,
    sourceUrl: row.source_url,
    title: row.title,
    description: row.description,
    summary: row.summary,
    primaryTag: row.primary_tag,
    tags: safeJsonArray(row.tags),
    status: row.status,
    coverUrl: row.cover_key ? `/api/inspirations/${row.id}/cover` : null,
    createdAt: row.created_at,
  };
}

export async function GET() {
  try {
    const user = await requireApiUser();
    const { DB } = bindings();
    const result = await DB.prepare(
      `SELECT id, source_url, title, description, summary, primary_tag, tags, status, cover_key, created_at
       FROM inspirations WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`,
    ).bind(user.userId).all<InspirationRow>();
    return Response.json({ inspirations: (result.results ?? []).map(toRecord) });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError('暂时无法读取灵感库，请稍后重试。', 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const runtime = bindings() as Cloudflare.Env & { XHS_DOWNLOADER_URL?: string };
    const { DB, FILES } = runtime;
    const form = await request.formData();
    const sharedText = String(form.get('sharedText') ?? '').trim();
    const titleInput = String(form.get('title') ?? '').trim();
    const sourceUrl = extractFirstUrl(sharedText);
    const files = form.getAll('images').filter((value): value is File => value instanceof File && value.size > 0);

    if (!sourceUrl && !files.length) return jsonError('请粘贴分享链接，或至少选择一张图片。');
    if (sourceUrl && !isSupportedSourceUrl(sourceUrl)) return jsonError('目前仅支持小红书的 HTTPS 分享链接。');
    if (files.length > 12 || files.reduce((total, file) => total + file.size, 0) > 40_000_000) {
      return jsonError('一次最多上传 12 张图片，且总大小不能超过 40 MB。');
    }

    if (sourceUrl) {
      const duplicate = await DB.prepare(
        'SELECT id FROM inspirations WHERE user_id = ? AND source_url = ? LIMIT 1',
      ).bind(user.userId, sourceUrl).first<{ id: string }>();
      if (duplicate) return jsonError('这篇内容已经在你的灵感库里了。', 409);
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    let title = titleInput || '新收藏的人像灵感';
    let description = sharedText.replace(sourceUrl, '').trim();
    const remoteImages: Array<{ bytes: ArrayBuffer; type: string; filename: string }> = [];

    if (sourceUrl && !files.length) {
      try {
        const downloader = await queryXhsDownloader(sourceUrl, runtime.XHS_DOWNLOADER_URL);
        if (downloader) {
          title = titleInput || downloader.title || title;
          description = downloader.description || description;
          for (const [index, imageUrl] of downloader.imageUrls.entries()) {
            try {
              const imageResponse = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' } });
              const type = imageResponse.headers.get('content-type') ?? '';
              const bytes = await imageResponse.arrayBuffer();
              if (imageResponse.ok && type.startsWith('image/') && bytes.byteLength > 0 && bytes.byteLength < 15_000_000) {
                remoteImages.push({ bytes, type, filename: `xiaohongshu-${index + 1}` });
              }
            } catch { /* Try the remaining images or the public-page fallback. */ }
          }
        }

        if (remoteImages.length) throw new Error('DOWNLOADER_SUCCEEDED');
        const page = await fetch(sourceUrl, {
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PortraitMuse/1.0; personal-bookmark-tool)' },
        });
        const pageLength = Number(page.headers.get('content-length') ?? 0);
        if (page.ok && pageLength < 3_000_000 && (page.headers.get('content-type') ?? '').includes('text/html')) {
          const html = await page.text();
          const parsed = extractXiaohongshuPage(html);
          title = titleInput || parsed.title || title;
          description = parsed.description || description;
          for (const [index, imageUrl] of parsed.imageUrls.entries()) {
            try {
              const imageHost = new URL(imageUrl).hostname.toLowerCase();
              if (!(imageHost === 'xhscdn.com' || imageHost.endsWith('.xhscdn.com') || imageHost.endsWith('.xiaohongshu.com'))) continue;
              const imageResponse = await fetch(imageUrl, {
                headers: { 'Referer': page.url, 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' },
              });
              const type = imageResponse.headers.get('content-type') ?? '';
              const bytes = await imageResponse.arrayBuffer();
              if (imageResponse.ok && type.startsWith('image/') && bytes.byteLength > 0 && bytes.byteLength < 15_000_000) {
                remoteImages.push({ bytes, type, filename: `xiaohongshu-${index + 1}` });
              }
            } catch {
              // Continue with any other images that remain available.
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'DOWNLOADER_SUCCEEDED') {
          // The connector already supplied the images; skip public-page parsing.
        }
        // Public-page parsing is best effort; the user can continue by uploading images.
      }
    }

    const classification = classifyPortrait(`${title} ${description}`);
    let coverKey: string | null = null;
    let coverType: string | null = null;
    const imageWrites: D1PreparedStatement[] = [];
    const uploadList: Array<{ bytes: ArrayBuffer; type: string; filename: string }> = [];

    for (const file of files.slice(0, 20)) {
      uploadList.push({ bytes: await file.arrayBuffer(), type: file.type || 'image/jpeg', filename: file.name });
    }
    if (!uploadList.length && remoteImages.length) uploadList.push(...remoteImages);

    for (const [position, image] of uploadList.entries()) {
      if (!image.type.startsWith('image/') || image.bytes.byteLength > 15_000_000) continue;
      const extension = image.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const key = `users/${user.userId}/inspirations/${id}/${String(position + 1).padStart(2, '0')}.${extension}`;
      await FILES.put(key, image.bytes, { httpMetadata: { contentType: image.type } });
      if (!coverKey) {
        coverKey = key;
        coverType = image.type;
      }
      imageWrites.push(
        DB.prepare(
          `INSERT INTO inspiration_images (id, inspiration_id, user_id, storage_key, filename, content_type, position, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(crypto.randomUUID(), id, user.userId, key, image.filename, image.type, position, now),
      );
    }

    const status = coverKey ? 'ready' : 'needs_upload';
    const insert = DB.prepare(
      `INSERT INTO inspirations
       (id, user_id, source_url, title, description, summary, primary_tag, tags, status, cover_key, cover_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, user.userId, sourceUrl || null, title.slice(0, 160), description.slice(0, 3000),
      classification.summary, classification.primaryTag, JSON.stringify(classification.tags), status,
      coverKey, coverType, now, now,
    );
    const tagWrites = classification.tags.map((tag, index) => DB.prepare(
      'INSERT OR IGNORE INTO user_tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), user.userId, tag, now + index));
    await DB.batch([insert, ...imageWrites, ...tagWrites]);

    return Response.json({
      inspiration: toRecord({
        id,
        source_url: sourceUrl || null,
        title,
        description,
        summary: classification.summary,
        primary_tag: classification.primaryTag,
        tags: JSON.stringify(classification.tags),
        status,
        cover_key: coverKey,
        created_at: now,
      }),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return jsonError('导入没有完成，请检查链接或改为上传图片。', 500);
  }
}
