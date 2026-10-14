import { createRoot } from 'react-dom/client';
import { useMemo, useState } from 'react';
import { Aperture, Cloud, LockKeyhole } from 'lucide-react';
import { InspirationApp } from '@/app/inspiration-app';
import { Cloud as CloudClient, validateConfig, type CloudConfig } from './cloud';
import '@/app/globals.css';
import './pages.css';

const configKey = 'portrait-muse-cloud-config';
function initialConfig(): CloudConfig | null {
  try {
    const configured = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
      ? { url: import.meta.env.VITE_SUPABASE_URL, key: import.meta.env.VITE_SUPABASE_ANON_KEY }
      : JSON.parse(localStorage.getItem(configKey) || 'null');
    return configured ? validateConfig(configured) : null;
  } catch { return null; }
}

function App() {
  const [config, setConfig] = useState(initialConfig);
  const client = useMemo(() => config ? new CloudClient(config) : null, [config]);
  const [session, setSession] = useState(() => client?.session || null);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signup, setSignup] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  if (client && session) return <InspirationApp user={{ name: session.user.user_metadata?.name || session.user.email.split('@')[0], email: session.user.email }} deployment="pages" transport={client.transport} onSignOut={() => { void client.signOut().finally(() => { setSession(null); window.location.reload(); }); }} />;

  return <main className="auth-shell"><section className="auth-card pages-auth">
    <div className="brand-mark"><Aperture /></div><p className="eyebrow">PORTRAIT MUSE · 人像灵感库</p>
    <h1>{config ? '留住每一次灵感' : '你的摄影灵感空间'}</h1>
    <p>{config ? '用独立账号登录，在手机和电脑间整理你的私人摄影参考。' : 'GitHub Pages 页面已就绪。连接云端空间后，即可登录、上传照片并同步收藏。'}</p>
    {!config ? <>
      <div className="connection-status"><Cloud /><div><strong>云端空间尚未连接</strong><span>原网站的收藏仍保留在原站。当前页面不会公开你的素材。</span></div></div>
      <details><summary>连接我的 Supabase 云端空间</summary><form onSubmit={event => {
        event.preventDefault();setError('');
        try { const value = validateConfig({ url: url.trim().replace(/\/$/, ''), key: key.trim() });localStorage.setItem(configKey, JSON.stringify(value));setConfig(value); }
        catch (e) {setError(e instanceof Error ? e.message : '配置无效。');}
      }}><label>项目地址<input required type="url" placeholder="https://项目编号.supabase.co" value={url} onChange={e => setUrl(e.target.value)} /></label><label>公开 publishable / anon key<input required value={key} placeholder="仅填写公开 key" onChange={e => setKey(e.target.value)} /></label><p className="form-hint">先在自己的 Supabase 项目运行仓库中的 supabase/schema.sql。请勿填写 secret 或 service_role 密钥。</p><button className="signin-button" type="submit">连接云端空间</button></form></details>
      <a className="signin-button" href="https://portrait-muse.rion413359.chatgpt.site/" target="_blank" rel="noreferrer">打开原有云端灵感库</a>
      <a className="text-link" href="https://github.com/59Rion/portrait-muse#github-pages-迁移说明" target="_blank" rel="noreferrer">查看部署说明与功能进度 ↗</a>
    </> : <form onSubmit={async event => {
      event.preventDefault();setPending(true);setError('');
      try { const data = await client!.auth(signup ? `signup?redirect_to=${encodeURIComponent(location.origin + location.pathname)}` : 'token?grant_type=password', { email, password });
        if (data.access_token) setSession(client!.session);
        else setError('注册请求已提交，请检查邮箱完成验证，然后返回登录。');
      } catch (e) {setError(e instanceof Error ? e.message : '登录失败。');}
      finally {setPending(false);}
    }}><label>邮箱<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" /></label><label>密码<input required type="password" autoComplete={signup ? 'new-password' : 'current-password'} minLength={8} value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 8 位密码" /></label><button className="signin-button" disabled={pending} type="submit"><LockKeyhole />{pending ? '正在连接…' : signup ? '创建独立账号' : '登录我的空间'}</button><button className="text-link" type="button" onClick={() => {setSignup(!signup);setError('');}}>{signup ? '已有账号？返回登录' : '第一次使用？创建账号'}</button><button className="text-link" type="button" onClick={() => {localStorage.removeItem(configKey);setConfig(null);}}>切换云端空间</button></form>}
    {error && <p className="auth-message" role="status">{error}</p>}
    <small>私人素材不存入 GitHub 仓库 · 图片按账号隔离</small>
  </section></main>;
}
createRoot(document.getElementById('root')!).render(<App />);
