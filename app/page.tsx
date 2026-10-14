import { chatGPTSignInPath, getChatGPTUser } from '@/app/chatgpt-auth';
import { InspirationApp } from '@/app/inspiration-app';
import { Camera, LockKeyhole } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const authenticatedUser = await getChatGPTUser();
  const user = authenticatedUser ?? (process.env.NODE_ENV === 'development'
    ? { userId: 'local-preview-user', email: 'preview@local.test', displayName: '本地预览', fullName: '本地预览' }
    : null);

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="brand-mark"><Camera aria-hidden="true" /></div>
          <p className="eyebrow">私人摄影资料库</p>
          <h1>你的灵感，只属于你</h1>
          <p>登录后查看收藏、上传图片并整理拍摄项目。每位用户都有完全独立的素材空间。</p>
          <a className="signin-button" href={chatGPTSignInPath('/')} target="_top">
            <LockKeyhole aria-hidden="true" /> 安全登录
          </a>
          <small>默认私密 · 图片不会公开展示</small>
        </section>
      </main>
    );
  }

  return <InspirationApp user={{ name: user.displayName, email: user.email }} />;
}
