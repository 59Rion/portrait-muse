export type CloudConfig = { url: string; key: string };
export type Session = { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string; user_metadata?: { name?: string } } };
type Row = Record<string, any>;
const sessionKey = 'portrait-muse-cloud-session';

export function validateConfig(config: CloudConfig) {
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
  async auth(path: string, body?: unknown): Promise<Row> {
    const response = await fetch(`${this.config.url}/auth/v1/${path}`, { method: body ? 'POST' : 'GET', headers: { apikey: this.config.key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json() as Row;
    if (!response.ok) throw new Error(data.msg || data.error_description || data.message || '登录服务暂时不可用。');
    if (data.access_token) this.setSession({ ...data, expires_at: data.expires_at || Math.floor(Date.now() / 1000) + data.expires_in } as Session);
    return data;
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
  async signedUrl(key: string | null) {
    if (!key) return null;
    const data = await this.request(`/storage/v1/object/sign/portrait-images/${key}`, { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }) });
    return `${this.config.url}/storage/v1${data.signedURL}`;
  }
  async record(row: Row) {
    return { id: row.id, sourceUrl: row.source_url, title: row.title, description: row.description, summary: row.summary, primaryTag: row.primary_tag, tags: row.tags || [], status: row.status, coverUrl: await this.signedUrl(row.cover_key), createdAt: row.created_at };
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
          if (duplicates.length) return Response.json({ error: '这篇内容已经在你的灵感库里了。' }, { status: 409 });
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
        return Response.json({ inspiration: await this.record(row) }, { status: 201 });
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
        return Response.json({ images: await Promise.all(rows.map(async row => ({ ...row, url: await this.signedUrl(row.storage_key) }))) });
      }
      const item = path.pathname.match(/^\/api\/inspirations\/([\w-]+)$/);
      if (item) {
        if (method === 'PATCH') await this.table('inspirations', `id=eq.${item[1]}`, 'PATCH', { tags: body.tags, primary_tag: body.primaryTag, updated_at: Date.now() });
        else if (method === 'DELETE') {
          const images = await this.table('inspiration_images', `inspiration_id=eq.${item[1]}&select=storage_key`) as Row[];
          if (images.length) await this.request('/storage/v1/object/portrait-images', { method: 'DELETE', body: JSON.stringify({ prefixes: images.map(row => row.storage_key) }) });
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
        await this.table('project_items', 'on_conflict=project_id,inspiration_id', 'POST', { user_id: uid, project_id: projectItems[1], inspiration_id: body.inspirationId });
        return Response.json({ ok: true });
      }
      return Response.json({ error: '该功能尚未接入。' }, { status: 404 });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : '云端请求失败。' }, { status: 400 });
    }
  };
}
