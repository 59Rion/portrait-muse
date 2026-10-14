import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';

export async function requireApiUser() {
  const user = await getChatGPTUser();
  if (user) return user;

  if (process.env.NODE_ENV === 'development') {
    return {
      userId: 'local-preview-user',
      displayName: '本地预览',
      email: 'preview@local.test',
      fullName: '本地预览',
    };
  }

  throw new Response('Unauthorized', { status: 401 });
}

export function bindings() {
  return env as Cloudflare.Env;
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export function safeJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function extractFirstUrl(value: string) {
  const match = value.match(/https?:\/\/[^\s]+/i);
  return (match?.[0] ?? '').replace(/[，。；、)）\]】]+$/, '');
}

export function isSupportedSourceUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (
      host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com') ||
      host === 'xhslink.com' || host.endsWith('.xhslink.com') ||
      host === 'xhslink.cn' || host.endsWith('.xhslink.cn')
    );
  } catch {
    return false;
  }
}

export function classifyPortrait(text: string) {
  const source = text.toLowerCase();
  const dictionary: Array<[string, string[]]> = [
    ['汉服', ['汉服', '古风', '园林', '国风']],
    ['韩系', ['韩系', '韩风', '奶油']],
    ['少女', ['少女', '甜美', '青春']],
    ['清冷', ['清冷', '冷调', '疏离', '蓝调']],
    ['氛围感', ['氛围', '电影感', '情绪']],
    ['复古', ['复古', '胶片']],
    ['室内', ['室内', '居家', '咖啡馆']],
    ['自然光', ['自然光', '窗边光', '逆光', '日落']],
    ['夜景', ['夜景', '霓虹', '闪光灯']],
    ['姿势参考', ['姿势', '动作', '摆姿']],
    ['妆造参考', ['妆容', '妆造', '发型', '服装']],
    ['相机参考', ['相机', '松下', 'lumix', 'gh6', '镜头']],
    ['柔光', ['黑柔', '柔光']],
  ];
  const tags = dictionary
    .filter(([, needles]) => needles.some((needle) => source.includes(needle)))
    .map(([tag]) => tag);
  if (!tags.length) tags.push('人像', '待确认');
  const primaryTag = tags.find((tag) => ['汉服', '韩系', '少女', '清冷', '氛围感', '复古'].includes(tag)) ?? '人像';
  return {
    primaryTag,
    tags: Array.from(new Set(['人像', ...tags])).slice(0, 8),
    summary: `这是一组${tags.slice(0, 3).join('、') || '人像'}摄影参考，可用于拍摄策划、构图与氛围整理。`,
  };
}
