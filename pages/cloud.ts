import { emptyBrief, parseBrief, parsePlan, rankReferences, type Reference } from '../lib/shooting';
export type CloudConfig = { url: string; key: string; downloaderUrl?: string; projectWorkspaceEnabled?: boolean };
export type Session = { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string; user_metadata?: { name?: string } } };
type Row = Record<string, any>;
const sessionKey = 'portrait-muse-cloud-session';

export function validateConfig(config: CloudConfig) {
  if (config.downloaderUrl && !/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(config.downloaderUrl) && config.downloaderUrl !== `${config.url}/functions/v1/media-import`) throw new Error('下载服务必须属于本站云端项目或已确认的 Render HTTPS 地址。');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.url)) throw new Error('请输入 https://项目编号.supabase.co 格式的项目地址。');
  if (config.key.startsWith('sb_publishable_')) return config;
  try {
    const payload = JSON.parse(atob(config.key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.role === 'anon') return config;
  } catch { /* Reject private and invalid keys. */ }
  throw new Error('只能填写公开 publishable / anon key，不能填写 service_role 或 secret key。');
}

export class Cloud {
  session: Session | null = null;
  private refreshPending: Promise<void> | null = null;
  constructor(public config: CloudConfig) {
    validateConfig(config);
    try { this.session = JSON.parse(localStorage.getItem(`${sessionKey}:${config.url}`) || 'null'); } catch { this.session = null; }
  }
  setSession(value: Session | null) {
    this.session = value;
    if (value) localStorage.setItem(`${sessionKey}:${this.config.url}`, JSON.stringify(value));
    else localStorage.removeItem(`${sessionKey}:${this.config.url}`);
  }
  async resumeEmailConfirmation() {
    const values = new URLSearchParams(location.hash.slice(1));
    const accessToken = values.get('access_token');
    const refreshToken = values.get('refresh_token');
    if (!accessToken || !refreshToken) return;
    try {
      const response = await fetch(`${this.config.url}/auth/v1/user`, { headers: { apikey: this.config.key, Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('邮箱验证已返回，请重新登录。');
      const user = await response.json() as Session['user'];
      this.setSession({ access_token: accessToken, refresh_token: refreshToken, expires_at: Math.floor(Date.now() / 1000) + Number(values.get('expires_in') || 3600), user });
    } finally { history.replaceState({}, '', location.pathname + location.search); }
  }
  async auth(path: string, body?: unknown): Promise<Row> {
    let response: Response;
    try {
      response = await fetch(`${this.config.url}/auth/v1/${path}`, { method: body ? 'POST' : 'GET', headers: { apikey: this.config.key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000) });
    } catch {
      throw new Error('无法连接登录服务。请检查网络后重试；云端项目暂停或恢复中也会出现此问题。这不代表邮箱或密码错误。');
    }
    const data = await response.json().catch(() => null) as Row | null;
    if (response.status >= 500 || !data) throw new Error('登录服务暂时不可用，请稍后重新检查连接。请勿重复注册或修改密码。');
    if (!response.ok) {
      const messages: Record<string, string> = {
        invalid_credentials: '邮箱或密码不正确，请确认使用的是本站独立账号。',
        email_not_confirmed: '请先在邮箱中完成验证，再返回登录。',
        over_email_send_rate_limit: '验证邮件发送过于频繁，请稍后重试。',
        over_request_rate_limit: '请求过于频繁，请稍后重试，不要连续提交。',
        email_address_not_authorized: '当前邮件服务暂不允许向此邮箱发送验证信，请联系站点管理员配置邮件服务。',
        email_address_invalid: '请填写有效的邮箱地址。',
        signup_disabled: '本站暂时关闭了新账号注册，请联系站点管理员。',
        user_already_exists: '此邮箱已注册，请返回登录。',
        weak_password: '密码强度不足，请使用更长的字母、数字和符号组合。',
      };
      throw new Error(messages[data.error_code || data.code] || data.msg || data.error_description || data.message || '登录服务暂时不可用。');
    }
    if (data.access_token) this.setSession({ ...data, expires_at: data.expires_at || Math.floor(Date.now() / 1000) + data.expires_in } as Session);
    return data;
  }
  async checkAuthConnection() {
    const data = await this.auth('settings');
    if (typeof data.disable_signup !== 'boolean' || typeof data.mailer_autoconfirm !== 'boolean') throw new Error('登录服务返回了异常响应，请稍后重试。');
    return { signupEnabled: !data.disable_signup, emailVerificationRequired: !data.mailer_autoconfirm };
  }
  async ready() {
    if (!this.session) throw new Error('请先登录。');
    if (this.session.expires_at < Date.now() / 1000 + 60) {
      if (!this.refreshPending) this.refreshPending = this.auth('token?grant_type=refresh_token', { refresh_token: this.session.refresh_token }).then(() => undefined).finally(() => { this.refreshPending = null; });
      await this.refreshPending;
    }
  }
  async request(path: string, init: RequestInit = {}): Promise<Row> {
    await this.ready();
    const headers = new Headers(init.headers);
    headers.set('apikey', this.config.key);
    headers.set('Authorization', `Bearer ${this.session!.access_token}`);
    if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    const response = await fetch(`${this.config.url}${path}`, { ...init, headers });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as Row;
      throw new Error(data.message || data.error || '云端操作失败，请确认数据库初始化及访问策略。');
    }
    if (response.status === 204 || response.headers.get('content-length') === '0') return {};
    return await response.json().catch(() => ({})) as Row;
  }
  async table(name: string, query = '', method = 'GET', body?: unknown): Promise<Row[]> {
    return await this.request(`/rest/v1/${name}?${query}`, { method, headers: { Prefer: method === 'POST' ? 'return=representation,resolution=merge-duplicates' : 'return=representation' }, body: body === undefined ? undefined : JSON.stringify(body) }) as unknown as Row[];
  }
  async signOut() {
    try { await this.request('/auth/v1/logout', { method: 'POST' }); } finally { this.setSession(null); }
  }
  async signedUrl(key: string | null, bucket = 'portrait-images') {
    if (!key) return null;
    if (!['portrait-images', 'portrait-videos'].includes(bucket)) throw new Error('不支持的媒体存储空间。');
    const data = await this.request(`/storage/v1/object/sign/${bucket}/${key}`, { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }) });
    return `${this.config.url}/storage/v1${data.signedURL}`;
  }
  async record(row: Row) {
    return { id: row.id, sourceUrl: row.source_url, title: row.title, description: row.description, summary: row.summary, primaryTag: row.primary_tag, tags: row.tags || [], status: row.status, coverUrl: await this.signedUrl(row.cover_key), createdAt: row.created_at };
  }
  async downloadRemote(id: string) {
    if (!this.config.downloaderUrl) throw new Error('下载后台尚未连接。链接已保存，可先上传截图。');
    await this.ready();
    const edge = this.config.downloaderUrl === `${this.config.url}/functions/v1/media-import`;
    const response = await fetch(edge ? this.config.downloaderUrl : `${this.config.downloaderUrl}/imports`, { method: 'POST', headers: { Authorization: `Bearer ${this.session!.access_token}`, 'Content-Type': 'application/json', ...(edge ? { apikey: this.config.key } : {}) }, body: JSON.stringify({ inspirationId: id }), signal: AbortSignal.timeout(180_000) });
    const data = await response.json().catch(() => ({})) as Row;
    if (!response.ok) throw new Error(data.error || '下载后台尚未启动或暂时受限，请稍后在收藏详情重试。');
    const [row] = await this.table('inspirations', `id=eq.${id}`);
    if (!row) throw new Error('图片导入后未能重新读取收藏，请刷新页面。');
    return { inspiration: await this.record(row), message: data.message, downloadedCount: data.count, skipped: data.skipped };
  }
  private async uploads(id: string, form: FormData) {
    const files = form.getAll('images').filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length || files.length > 12 || files.some(f => !['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/avif'].includes(f.type) || f.size > 15_000_000) || files.reduce((n, f) => n + f.size, 0) > 40_000_000) throw new Error('请选择 1–12 张照片，每张不超过 15 MB，总计不超过 40 MB。');
    const existing = await this.table('inspiration_images', `inspiration_id=eq.${id}&select=position&order=position.desc&limit=1`) as Row[];
    const output = [];
    const uploadedKeys: string[] = [];
    let committed = false;
    try {
      const rows = [];
      for (const [i, file] of files.entries()) {
        const imageId = crypto.randomUUID();
        const key = `users/${this.session!.user.id}/inspirations/${id}/${imageId}`;
        await this.request(`/storage/v1/object/portrait-images/${key}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
        uploadedKeys.push(key);
        rows.push({ id: imageId, inspiration_id: id, user_id: this.session!.user.id, storage_key: key, filename: file.name, content_type: file.type, position: (existing[0]?.position ?? -1) + i + 1 });
      }
      await this.table('inspiration_images', '', 'POST', rows);
      committed = true;
      const [item] = await this.table('inspirations', `id=eq.${id}`) as Row[];
      await this.table('inspirations', `id=eq.${id}`, 'PATCH', { status: 'ready', cover_key: item.cover_key || rows[0].storage_key, updated_at: Date.now() });
      for (const row of rows) output.push({ id: row.id, filename: row.filename, position: row.position, url: await this.signedUrl(row.storage_key) });
      return { images: output, coverUrl: await this.signedUrl(item.cover_key || rows[0].storage_key) };
    } catch (error) {
      if (!committed && uploadedKeys.length) await this.request('/storage/v1/object/portrait-images', { method: 'DELETE', body: JSON.stringify({ prefixes: uploadedKeys }) }).catch(() => undefined);
      throw error;
    }
  }
  transport: typeof fetch = async (input, init = {}) => {
    try {
      await this.ready();
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
      const method = init.method || 'GET';
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      const uid = this.session!.user.id;
      const downloadRoute = path.pathname.match(/^\/api\/inspirations\/([\w-]+)\/download$/);
      if (downloadRoute && method === 'POST') return Response.json(await this.downloadRemote(downloadRoute[1]));
      if (path.pathname === '/api/agent/status') return Response.json(await this.request('/functions/v1/shooting-agent'));
      if (path.pathname === '/api/agent/turn' && method === 'POST') {
        return Response.json(await this.request('/functions/v1/shooting-agent', { method: 'POST', body: JSON.stringify(body) }));
      }
      if (path.pathname === '/api/references' && method === 'GET') {
        const ids = path.searchParams.get('ids');
        if (ids && !/^[a-z0-9,-]{1,2000}$/i.test(ids)) throw new Error('参考 ID 无效。');
        const rows = await this.table('inspirations', ids ? `id=in.(${ids})&limit=30` : 'order=created_at.desc&limit=500');
        const ranked = rankReferences(rows as Reference[], path.searchParams.get('query') || '').slice(0, 60);
        return Response.json({ references: await Promise.all(ranked.map(async row => ({ ...await this.record(row), reason: row.reason }))) });
      }
      const workspace = path.pathname.match(/^\/api\/projects\/([\w-]+)$/);
      if (workspace && method === 'GET') {
        const id = workspace[1];
        const [project] = await this.table('shoot_projects', `id=eq.${id}`);
        if (!project) return Response.json({ error: '项目不存在或无权访问。' }, { status: 404 });
        const [briefs, versions, members, messages] = await Promise.all([
          this.table('project_briefs', `project_id=eq.${id}`),
          this.table('shooting_plans', `project_id=eq.${id}&order=version.desc&limit=100`),
          this.table('project_items', `project_id=eq.${id}&select=inspiration_id`),
          this.table('project_messages', `project_id=eq.${id}&order=created_at.desc&limit=50`),
        ]);
        const rows = members.length ? await this.table('inspirations', `id=in.(${members.map(m => m.inspiration_id).join(',')})`) : [];
        return Response.json({ project, brief: briefs[0]?.data || emptyBrief, briefSaved: Boolean(briefs.length), versions, references: await Promise.all(rows.map(row => this.record(row))), messages: messages.reverse() });
      }
      const briefRoute = path.pathname.match(/^\/api\/projects\/([\w-]+)\/brief$/);
      if (briefRoute && method === 'PUT') {
        const brief = parseBrief(body.brief);
        await this.table('project_briefs', 'on_conflict=project_id', 'POST', { project_id: briefRoute[1], user_id: uid, data: brief, updated_at: Date.now() });
        return Response.json({ ok: true, brief });
      }
      const planRoute = path.pathname.match(/^\/api\/projects\/([\w-]+)\/plans$/);
      if (planRoute && method === 'POST') {
        const plan = parsePlan(body.plan);
        const brief = parseBrief(body.brief);
        const version = await this.request('/rest/v1/rpc/confirm_shooting_plan', { method: 'POST', body: JSON.stringify({ p_project: planRoute[1], p_plan: plan, p_brief: brief, p_origin: body.origin === 'ai' ? 'ai' : 'manual', p_note: String(body.note || '').slice(0, 1000) }) });
        return Response.json({ version });
      }
      if (path.pathname === '/api/inspirations') {
        if (method === 'GET') {
          const rows = await this.table('inspirations', 'select=*&order=created_at.desc&limit=200') as Row[];
          return Response.json({ inspirations: await Promise.all(rows.map(row => this.record(row))) });
        }
        const form = init.body as FormData;
        const shared = String(form.get('sharedText') || '').trim();
        const source = (shared.match(/https?:\/\/[^\s]+/i)?.[0] || '').replace(/[，。；、)）\]】]+$/, '');
        if (!source && !form.getAll('images').length) throw new Error('请粘贴链接或选择照片。');
        if (source) {
          const parsed = new URL(source);
          if (parsed.protocol !== 'https:' || !/^(?:[a-z0-9-]+\.)*(?:xiaohongshu\.com|xhslink\.(?:cn|com))$/.test(parsed.hostname)) throw new Error('目前支持小红书 HTTPS 分享链接。');
          const duplicates = await this.table('inspirations', `source_url=eq.${encodeURIComponent(source)}&select=id`);
          if (duplicates.length) {
            if (this.config.downloaderUrl) return Response.json(await this.downloadRemote(duplicates[0].id));
            return Response.json({ error: '这篇内容已经在你的灵感库里了。' }, { status: 409 });
          }
        }
        const text = shared.replace(source, '').replace(/先复制一下[\s\S]*$/, '').trim();
        const tags = ['人像', ...Object.entries({ 韩系: /韩系|韩风/, 汉服: /汉服|古风|国风/, 少女: /少女|青春/, 氛围感: /氛围|情绪|电影/, 清冷: /清冷|冷调|蓝调/, 自然光: /自然光|逆光|日落/, 相机参考: /松下|相机|镜头|lumix/i, 复古: /复古|胶片/ }).filter(([, pattern]) => pattern.test(text)).map(([name]) => name)];
        const id = crypto.randomUUID();
        const [row] = await this.table('inspirations', '', 'POST', { id, user_id: uid, source_url: source || null, title: text.slice(0, 100) || '新收藏的摄影灵感', description: text, summary: '已保存来源。可上传照片或截图，补充这组拍摄参考。', primary_tag: tags[1] || '人像', tags, status: 'needs_upload' }) as Row[];
        await this.table('user_tags', 'on_conflict=user_id,name', 'POST', tags.map(name => ({ user_id: uid, name })));
        if (form.getAll('images').length) {
          try { const uploaded = await this.uploads(id, form); return Response.json({ inspiration: { ...await this.record(row), status: 'ready', coverUrl: uploaded.coverUrl } }, { status: 201 }); }
          catch (error) { throw new Error(`链接记录已保存，图片上传失败。请打开该收藏补传：${error instanceof Error ? error.message : ''}`); }
        }
        if (source && this.config.downloaderUrl) {
          try { return Response.json(await this.downloadRemote(id), { status: 201 }); }
          catch (error) { return Response.json({ inspiration: await this.record(row), downloadWarning: `链接已保存，自动下载未完成：${error instanceof Error ? error.message : '请在详情重试或上传截图。'}` }, { status: 201 }); }
        }
        return Response.json({ inspiration: await this.record(row), downloadWarning: source ? '仅保存了链接：下载后台尚未配置，未发起媒体下载。' : undefined }, { status: 201 });
      }
      if (path.pathname === '/api/tags') {
        if (method === 'GET') return Response.json({ tags: (await this.table('user_tags', 'select=name&order=created_at.asc') as Row[]).map(row => row.name) });
        if (method === 'POST') { const name = String(body.name || '').trim().slice(0, 30); if (!name) throw new Error('请输入标签名称。'); await this.table('user_tags', 'on_conflict=user_id,name', 'POST', { user_id: uid, name }); }
        else await this.request('/rest/v1/rpc/change_portrait_tag', { method: 'POST', body: JSON.stringify({ old_name: method === 'DELETE' ? path.searchParams.get('name') : body.oldName, new_name: method === 'DELETE' ? null : String(body.newName || '').slice(0, 30) }) });
        return Response.json({ ok: true });
      }
      const images = path.pathname.match(/^\/api\/inspirations\/([\w-]+)\/images$/);
      if (images) {
        if (method === 'POST') return Response.json(await this.uploads(images[1], init.body as FormData));
        const rows = await this.table('inspiration_images', `inspiration_id=eq.${images[1]}&order=position.asc`) as Row[];
        return Response.json({ images: await Promise.all(rows.map(async row => ({ ...row, url: await this.signedUrl(row.storage_key, row.media_bucket || 'portrait-images') }))) });
      }
      const item = path.pathname.match(/^\/api\/inspirations\/([\w-]+)$/);
      if (item) {
        if (method === 'PATCH') await this.table('inspirations', `id=eq.${item[1]}`, 'PATCH', { tags: body.tags, primary_tag: body.primaryTag, updated_at: Date.now() });
        else if (method === 'DELETE') {
          const images = await this.table('inspiration_images', `inspiration_id=eq.${item[1]}&select=storage_key,media_bucket`) as Row[];
          for (const bucket of ['portrait-images', 'portrait-videos']) {
            const keys = images.filter(row => (row.media_bucket || 'portrait-images') === bucket).map(row => row.storage_key);
            if (keys.length) await this.request(`/storage/v1/object/${bucket}`, { method: 'DELETE', body: JSON.stringify({ prefixes: keys }) });
          }
          await this.table('inspirations', `id=eq.${item[1]}`, 'DELETE');
        }
        return Response.json({ ok: true });
      }
      if (path.pathname === '/api/projects') {
        if (method === 'GET') {
          const [projects, members] = await Promise.all([this.table('shoot_projects', 'order=created_at.desc'), this.table('project_items', 'select=project_id')]) as Row[][];
          return Response.json({ projects: projects.map(project => ({ ...project, item_count: members.filter(member => member.project_id === project.id).length })) });
        }
        const name = String(body.name || '').trim().slice(0, 100);
        if (!name) throw new Error('请输入项目名称。');
        const [project] = await this.table('shoot_projects', '', 'POST', { user_id: uid, name });
        return Response.json({ project: { ...project, item_count: 0 } }, { status: 201 });
      }
      const projectItems = path.pathname.match(/^\/api\/projects\/([\w-]+)\/items$/);
      if (projectItems && method === 'POST') {
        const ids = body.inspirationIds || [body.inspirationId];
        if (!Array.isArray(ids) || !ids.length || ids.length > 30 || ids.some(id => typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(id))) throw new Error('请选择 1–30 条有效参考。');
        await this.table('project_items', 'on_conflict=project_id,inspiration_id', 'POST', [...new Set(ids)].map(id => ({ user_id: uid, project_id: projectItems[1], inspiration_id: id })));
        return Response.json({ ok: true });
      }
      return Response.json({ error: '该功能尚未接入。' }, { status: 404 });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : '云端请求失败。' }, { status: 400 });
    }
  };
}

