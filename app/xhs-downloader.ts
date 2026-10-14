type DownloaderResult = {
  title: string;
  description: string;
  imageUrls: string[];
};

function firstText(value: unknown, keys: string[]): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  for (const child of Object.values(record)) {
    const nested: string = firstText(child, keys);
    if (nested) return nested;
  }
  return '';
}

function collectImageUrls(value: unknown, results: Set<string>) {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) && /(?:xhscdn\.com|xiaohongshu\.com)/i.test(value) && /(?:image|webp|jpe?g|png|heic|notes_pre_post)/i.test(value)) {
      results.add(value.replace(/^http:\/\//i, 'https://'));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectImageUrls(item, results));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((item) => collectImageUrls(item, results));
  }
}

export async function queryXhsDownloader(sourceUrl: string, endpoint?: string): Promise<DownloaderResult | null> {
  if (!endpoint) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const url = `${endpoint.replace(/\/$/, '')}/xhs/detail`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sourceUrl, download: false, check_record: false }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    const imageUrls = new Set<string>();
    collectImageUrls(data, imageUrls);
    return {
      title: firstText(data, ['作品标题', 'title', 'note_title']),
      description: firstText(data, ['作品描述', 'desc', 'description', 'note_desc']),
      imageUrls: [...imageUrls].slice(0, 12),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
