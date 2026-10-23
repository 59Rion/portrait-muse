'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Aperture, Archive, ArrowUpRight, Camera, Check, ChevronRight, Cloud,
  BookOpen, ExternalLink, FolderHeart, HardDrive, ImagePlus, Library, LoaderCircle, LockKeyhole,
  LogOut, Pencil, Plus, RefreshCw, Search, Settings, Share2, ShieldCheck, Sparkles,
  Tags, Trash2, Upload, UserRound, WandSparkles, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ProjectWorkspace } from '@/app/project-workspace';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

type Inspiration = {
  id: string;
  sourceUrl: string | null;
  title: string;
  description: string;
  summary: string;
  primaryTag: string;
  tags: string[];
  status: string;
  coverUrl: string | null;
  createdAt: number;
};

type Project = { id: string; name: string; description: string; created_at: number; item_count: number };
type InspirationImage = { id: string; filename: string; position: number; url: string; content_type?: string };
type DailyTip = { tag: string; title: string; text: string; source: string; sourceLabel: string };

const starterShareText = '松门崛起！这些照片都是用松下拍的！ 好像好多宝宝都在问是不是理光拍的！ https://xhslink.cn/o/2DeZqpGnlGT 先复制一下，再到【小红书】打开查看笔记。';

const dailyTips: DailyTip[] = [
  { tag: '曝光三角', title: '先决定画面效果，再补足曝光', text: '光圈控制景深，快门控制动作凝固或拖影，ISO负责增益。先锁定最重要的效果，再调整另外两项。', source: 'https://www.sony.com/electronics/support/cameras-camcorders/articles/00025973', sourceLabel: 'Sony 摄影基础' },
  { tag: '光圈', title: '数字越小，背景通常越虚', text: '较低的 f 值代表更大的光圈，进光更多、景深更浅，适合把人像主体从杂乱背景中分离出来。', source: 'https://www.nikonusa.com/learn-and-explore/c/tips-and-techniques/understanding-maximum-aperture', sourceLabel: 'Nikon Learn & Explore' },
  { tag: '快门', title: '人物在动，就先照顾快门', text: '快门越快越容易凝固动作；慢快门会保留移动轨迹。拍走动、甩裙摆或抓拍时，先检查快门是否足够快。', source: 'https://www.sony.com/electronics/support/cameras-camcorders/articles/00025973', sourceLabel: 'Sony 摄影基础' },
  { tag: 'ISO', title: 'ISO 是亮度与画质的交换', text: '提高 ISO 能帮助弱光下使用更快快门，但通常会增加噪点并损失细节。先保证拍清楚，再寻找可接受的最低 ISO。', source: 'https://www.sony.com/electronics/support/articles/00267930', sourceLabel: 'Sony 摄影基础' },
  { tag: '曝光补偿', title: '相机觉得“正确”，不一定符合情绪', text: '浅色场景可尝试正补偿，深色或剪影场景可尝试负补偿。拍完立即回看高光和肤色，再微调。', source: 'https://www.sony.com/electronics/support/articles/00267925', sourceLabel: 'Sony 摄影基础' },
  { tag: '人像', title: '虚化只是手段，注意力才是目的', text: '大光圈能减弱背景干扰，但人物眼神、轮廓和环境关系仍然决定照片是否成立。先清理边缘，再按快门。', source: 'https://www.nikonusa.com/learn-and-explore/c/tips-and-techniques/what-is-aperture', sourceLabel: 'Nikon Learn & Explore' },
  { tag: '自动 ISO', title: '光线变化快时，让 ISO 自动追赶', text: '在光圈优先或手动模式中设置自动 ISO 与最低快门，可把注意力留给人物表情和构图。', source: 'https://www.nikonusa.com/learn-and-explore/c/tips-and-techniques/understanding-auto-iso', sourceLabel: 'Nikon Learn & Explore' },
  { tag: '闪光灯', title: '试试把灯光反射出去', text: '机顶闪光灯直打容易生硬；条件允许时，可朝白色墙面或天花板跳闪，让光线更大、更柔和。', source: 'https://static.nikonusa.com/pdf/nikonschool/sat.pdf', sourceLabel: 'Nikon School' },
  { tag: '视频快门', title: '视频快门可从帧率的两倍附近开始', text: '24p 常从约 1/50 秒开始，30p 从约 1/60 秒开始，再根据动作清晰度和环境光线调整。', source: 'https://www.sony.com/electronics/support/articles/00268256', sourceLabel: 'Sony 视频基础' },
];

export function InspirationApp({ user, transport, deployment = 'sites', onSignOut, workspaceEnabled = false, downloadEnabled = false }: { user: { name: string; email: string }; transport?: typeof globalThis.fetch; deployment?: 'sites' | 'pages'; onSignOut?: () => void; workspaceEnabled?: boolean; downloadEnabled?: boolean }) {
  const fetch = useMemo(() => transport ?? globalThis.fetch.bind(globalThis), [transport]);
  const [view, setView] = useState<'library' | 'projects' | 'shortcut' | 'settings'>('library');
  const [items, setItems] = useState<Inspiration[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState('全部');
  const [query, setQuery] = useState('');
  const [sharedText, setSharedText] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selected, setSelected] = useState<Inspiration | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [editingTags, setEditingTags] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [userTags, setUserTags] = useState<string[]>([]);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [renamingTag, setRenamingTag] = useState('');
  const [renameDraft, setRenameDraft] = useState('');
  const [gallery, setGallery] = useState<InspirationImage[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [downloadingImages, setDownloadingImages] = useState(false);
  const [detailNotice, setDetailNotice] = useState('');
  const [tipOffset, setTipOffset] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const detailFileRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selected?.id || null;

  const dailyTip = dailyTips[(Math.floor(Date.now() / 86400000) + tipOffset) % dailyTips.length];

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const incoming = params.get('sharedText') || params.get('text') || params.get('url');
    if (incoming) {
      setSharedText(incoming);
      setMessage('已从 iPhone 分享菜单带入链接，确认后即可收藏。');
      window.history.replaceState({}, '', window.location.pathname);
    }
    void loadData();
  }, []);

  useEffect(() => {
    type ToolContext = {
      registerTool: (tool: {
        name: string;
        title: string;
        description: string;
        inputSchema: object;
        annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
        execute: (input: unknown) => Promise<unknown>;
      }, options: { signal: AbortSignal }) => void | Promise<void>;
    };
    const modelContext = (document as Document & { modelContext?: ToolContext }).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(modelContext.registerTool({
        name: 'save_inspiration_link',
        title: '保存摄影灵感链接',
        description: '把一个分享链接或分享文案保存到当前用户的私人摄影灵感库，并更新页面。',
        inputSchema: {
          type: 'object',
          properties: { sharedText: { type: 'string', minLength: 1, description: '包含公开链接的分享文案或完整 URL' } },
          required: ['sharedText'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        async execute(input) {
          const value = input as { sharedText?: unknown };
          if (typeof value.sharedText !== 'string' || !value.sharedText.trim()) throw new Error('sharedText 必须是非空文本');
          const form = new FormData();
          form.set('sharedText', value.sharedText.trim());
          const response = await fetch('/api/inspirations', { method: 'POST', body: form });
          const data = await response.json() as { inspiration?: Inspiration; error?: string };
          if (!response.ok || !data.inspiration) throw new Error(data.error || '保存失败');
          setItems((current) => [data.inspiration!, ...current]);
          setView('library');
          setMessage('已通过快捷工具保存到你的私人灵感库。');
          return { id: data.inspiration.id, title: data.inspiration.title, status: data.inspiration.status };
        },
      }, { signal: lifecycle.signal })).catch(() => undefined);
    } catch {
      return;
    }
    return () => lifecycle.abort();
  }, []);

  async function loadData() {
    try {
      const [inspirationResponse, projectResponse, tagResponse] = await Promise.all([
        fetch('/api/inspirations'), fetch('/api/projects'), fetch('/api/tags'),
      ]);
      if (inspirationResponse.ok) {
        const data = await inspirationResponse.json() as { inspirations: Inspiration[] };
        if (data.inspirations.length) {
          setItems(data.inspirations);
        } else if (deployment !== 'pages' && !localStorage.getItem('portrait-muse-starter-imported')) {
          localStorage.setItem('portrait-muse-starter-imported', 'pending');
          const starterForm = new FormData();
          starterForm.set('sharedText', starterShareText);
          const starterResponse = await fetch('/api/inspirations', { method: 'POST', body: starterForm });
          const starterData = await starterResponse.json() as { inspiration?: Inspiration };
          if (starterResponse.ok && starterData.inspiration) {
            setItems([starterData.inspiration]);
            localStorage.setItem('portrait-muse-starter-imported', 'done');
            setMessage(starterData.inspiration.status === 'ready'
              ? '已导入你提供的松下摄影笔记与公开图片。'
              : '已导入松下摄影笔记；如图片暂时受限，可从相册补充。');
          } else {
            localStorage.removeItem('portrait-muse-starter-imported');
          }
        }
      }
      if (projectResponse.ok) {
        const data = await projectResponse.json() as { projects: Project[] };
        setProjects(data.projects);
      }
      if (tagResponse.ok) {
        const data = await tagResponse.json() as { tags: string[] };
        setUserTags(data.tags);
      }
    } catch {
      setMessage('无法连接资料库，请检查网络或云端空间配置。');
    }
  }

  useEffect(() => {
    setDetailNotice('');
    if (!selected) { setGallery([]); return; }
    void fetch(`/api/inspirations/${selected.id}/images`)
      .then(async (response) => response.ok ? await response.json() as { images: InspirationImage[] } : { images: [] as InspirationImage[] })
      .then((data) => setGallery(data.images))
      .catch(() => setGallery([]));
  }, [selected?.id]);

  async function handleImport() {
    if (!sharedText.trim() && !selectedFiles.length) {
      setMessage('请先粘贴分享链接，或从相册选择图片。');
      return;
    }
    setImporting(true);
    setMessage('正在保存并整理这组灵感…');
    const form = new FormData();
    form.set('sharedText', sharedText);
    selectedFiles.forEach((file) => form.append('images', file));
    try {
      const response = await fetch('/api/inspirations', { method: 'POST', body: form });
      const data = await response.json() as { inspiration?: Inspiration; error?: string; downloadWarning?: string; message?: string };
      if (!response.ok || !data.inspiration) throw new Error(data.error || '导入失败');
      setItems((current) => [data.inspiration!, ...current]);
      setSharedText('');
      setSelectedFiles([]);
      if (fileRef.current) fileRef.current.value = '';
      setMessage(data.downloadWarning || data.message || (data.inspiration.status === 'needs_upload'
        ? '链接已保存。平台未能取得图片，你可以稍后补充上传。'
        : '已保存到你的私人灵感库。'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败，请改为上传图片。');
    } finally {
      setImporting(false);
    }
  }

  async function createProject() {
    if (!projectName.trim()) return;
    const response = await fetch('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: projectName }),
    });
    const data = await response.json() as { project?: Project; error?: string };
    if (response.ok && data.project) {
      setProjects((current) => [data.project!, ...current]);
      setProjectName(''); setProjectOpen(false);
    } else setMessage(data.error || '项目创建失败。');
  }

  async function saveTags() {
    if (!selected) return;
    const tags = tagDraft.split(/[，,、\s]+/).map((tag) => tag.trim()).filter(Boolean);
    const response = await fetch(`/api/inspirations/${selected.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags, primaryTag: tags[0] || '人像' }),
    });
    if (!response.ok) { setMessage('标签修改没有保存。'); return; }
    const updated = { ...selected, tags, primaryTag: tags[0] || '人像' };
    setSelected(updated);
    setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    for (const tag of tags) {
      if (!userTags.includes(tag)) {
        void fetch('/api/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: tag }) });
      }
    }
    setUserTags((current) => Array.from(new Set([...current, ...tags])));
    setEditingTags(false);
  }

  async function addTag() {
    const name = newTag.trim();
    if (!name) return;
    const response = await fetch('/api/tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    if (!response.ok) { setMessage('标签没有添加成功。'); return; }
    setUserTags((current) => Array.from(new Set([...current, name])));
    setNewTag('');
  }

  async function renameTag(oldName: string) {
    const newName = renameDraft.trim();
    if (!newName || newName === oldName) { setRenamingTag(''); return; }
    const response = await fetch('/api/tags', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oldName, newName }),
    });
    if (!response.ok) { setMessage('标签没有改名成功。'); return; }
    setUserTags((current) => Array.from(new Set(current.map((tag) => tag === oldName ? newName : tag))));
    setItems((current) => current.map((item) => ({
      ...item,
      tags: Array.from(new Set(item.tags.map((tag) => tag === oldName ? newName : tag))),
      primaryTag: item.primaryTag === oldName ? newName : item.primaryTag,
    })));
    if (filter === oldName) setFilter(newName);
    setRenamingTag(''); setRenameDraft('');
  }

  async function deleteTag(name: string) {
    if (!window.confirm(`删除“${name}”标签？已有收藏中的这个标签也会移除。`)) return;
    const response = await fetch(`/api/tags?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!response.ok) { setMessage('标签没有删除成功。'); return; }
    setUserTags((current) => current.filter((tag) => tag !== name));
    setItems((current) => current.map((item) => {
      const tags = item.tags.filter((tag) => tag !== name);
      return { ...item, tags, primaryTag: item.primaryTag === name ? (tags[0] || '人像') : item.primaryTag };
    }));
    if (filter === name) setFilter('全部');
  }

  async function uploadImages(files: File[]) {
    if (!selected || !files.length) return;
    setUploadingImages(true);
    const form = new FormData();
    files.forEach((file) => form.append('images', file));
    try {
      const response = await fetch(`/api/inspirations/${selected.id}/images`, { method: 'POST', body: form });
      const data = await response.json() as { images?: InspirationImage[]; coverUrl?: string; error?: string };
      if (!response.ok || !data.images) throw new Error(data.error || '图片没有上传成功。');
      setGallery((current) => [...current, ...data.images!]);
      const updated = { ...selected, coverUrl: data.coverUrl || selected.coverUrl, status: 'ready' };
      setSelected(updated);
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(`已保存 ${data.images.length} 张截图或照片。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '图片没有上传成功。');
    } finally {
      setUploadingImages(false);
      if (detailFileRef.current) detailFileRef.current.value = '';
    }
  }

  async function deleteSelected() {
    if (!selected || !window.confirm('确定删除这条灵感及其云端图片吗？此操作无法撤销。')) return;
    const response = await fetch(`/api/inspirations/${selected.id}`, { method: 'DELETE' });
    if (!response.ok) { setMessage('删除失败，请稍后重试。'); return; }
    setItems((current) => current.filter((item) => item.id !== selected.id));
    setSelected(null);
    setMessage('已删除这条灵感。');
  }

  async function addSelectedToProject() {
    if (!selected) return;
    if (!selectedProjectId) { setMessage('请先选择一个拍摄项目。'); return; }
    const response = await fetch(`/api/projects/${selectedProjectId}/items`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inspirationId: selected.id }),
    });
    if (!response.ok) { setMessage('暂时无法加入项目。'); return; }
    setProjects((current) => current.map((project) => project.id === selectedProjectId ? { ...project, item_count: project.item_count + 1 } : project));
    setSelected(null);
    setMessage('已加入拍摄项目。');
  }

  async function downloadSelected() {
    if (!selected || downloadingImages) return;
    setDownloadingImages(true); setDetailNotice('正在启动下载后台。免费实例首次启动可能需要约一分钟，请勿重复点击。');
    try {
      const response = await fetch(`/api/inspirations/${selected.id}/download`, { method: 'POST' });
      const data = await response.json() as { inspiration?: Inspiration; error?: string; message?: string };
      if (!response.ok || !data.inspiration) throw new Error(data.error || '图片下载未完成。');
      setItems(current => current.map(item => item.id === data.inspiration!.id ? data.inspiration! : item));
      if (selectedIdRef.current !== data.inspiration.id) { setMessage(data.message || '图片下载已完成，可打开收藏查看。'); return; }
      setSelected(data.inspiration);
      const galleryResponse = await fetch(`/api/inspirations/${selected.id}/images`);
      if (galleryResponse.ok) setGallery((await galleryResponse.json() as { images: InspirationImage[] }).images);
      setDetailNotice(data.message || '已下载到当前账号的私有图库。');
    } catch (error) {
      const text = error instanceof Error ? error.message : '暂时下载失败，可稍后重试或补充截图。';
      if (selectedIdRef.current === selected.id) setDetailNotice(text); else setMessage(text);
    }
    finally { setDownloadingImages(false); }
  }

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesFilter = filter === '全部' || item.tags.includes(filter) || item.primaryTag === filter;
      const haystack = `${item.title} ${item.summary} ${item.description} ${item.tags.join(' ')}`.toLowerCase();
      return matchesFilter && (!needle || haystack.includes(needle));
    });
  }, [items, filter, query]);

  const availableTags = useMemo(() => Array.from(new Set([
    ...userTags,
    ...items.flatMap((item) => item.tags),
  ])), [userTags, items]);

  return (
    <main className="app-shell">
      <aside className="desktop-sidebar">
        <div className="wordmark"><span><Aperture /></span> 人像灵感库</div>
        <nav aria-label="主要导航">
          <NavButton active={view === 'library'} icon={<Library />} onClick={() => setView('library')}>灵感库</NavButton>
          <NavButton active={view === 'projects'} icon={<FolderHeart />} onClick={() => setView('projects')}>拍摄项目</NavButton>
          <NavButton active={view === 'shortcut'} icon={<Share2 />} onClick={() => setView('shortcut')}>快捷收藏</NavButton>
          <NavButton active={view === 'settings'} icon={<Settings />} onClick={() => setView('settings')}>设置</NavButton>
        </nav>
        <div className="privacy-card"><LockKeyhole /><div><strong>私人空间</strong><span>只有你能查看素材</span></div></div>
        <div className="account"><div>{user.name.slice(0, 1).toUpperCase()}</div><span><strong>{user.name}</strong><small>{user.email}</small></span></div>
      </aside>

      <section className="workspace">
        <header className="mobile-header">
          <div className="wordmark"><span><Aperture /></span> 人像灵感库</div>
          <Button variant="ghost" size="icon" aria-label="打开设置" onClick={() => setView('settings')}><Settings /></Button>
        </header>

        {view === 'library' && <>
          <section className="capture-panel">
            <div className="capture-copy">
              <p className="eyebrow"><Sparkles /> 快速收藏</p>
              <h1>今天遇见了什么灵感？</h1>
              <article className="daily-tip">
                <div><span><BookOpen /> 每日摄影知识 · {dailyTip.tag}</span><button onClick={() => setTipOffset((value) => value + 1)} aria-label="换一条摄影知识"><RefreshCw /></button></div>
                <strong>{dailyTip.title}</strong>
                <p>{dailyTip.text}</p>
                <a href={dailyTip.source} target="_blank" rel="noreferrer">来源：{dailyTip.sourceLabel} <ExternalLink /></a>
              </article>
            </div>
            <div className="capture-form">
              <Textarea value={sharedText} onChange={(event) => setSharedText(event.target.value)} placeholder="粘贴分享链接或整段分享文案…" aria-label="小红书分享链接或文案" />
              <div className="capture-actions">
                <input ref={fileRef} className="sr-only" type="file" accept="image/*" multiple onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))} />
                <Button variant="outline" size="lg" onClick={() => fileRef.current?.click()}><ImagePlus /> {selectedFiles.length ? `已选 ${selectedFiles.length} 张` : '选择图片'}</Button>
                <Button size="lg" className="save-button" onClick={handleImport} disabled={importing}>
                  {importing ? <LoaderCircle className="animate-spin" /> : <WandSparkles />}{importing ? '正在整理' : '保存灵感'}
                </Button>
              </div>
              {importing && downloadEnabled && <p className="studio-hint">正在解析并保存图片或视频，请不要重复提交。受限笔记会保留链接并说明原因。图片每张最多 15 MB，视频最多 40 MB。</p>}
              {message && <div className="inline-message"><Check /> {message}<button onClick={() => setMessage('')} aria-label="关闭提示"><X /></button></div>}
            </div>
          </section>

          <section className="library-section">
            <div className="section-heading">
              <div><p className="eyebrow">我的收藏</p><h2>灵感库</h2></div>
              <div className="search-field"><Search /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索风格、场景、光线…" /></div>
            </div>
            <div className="filter-row" role="list" aria-label="灵感标签筛选">
              <button className={filter === '全部' ? 'active' : ''} onClick={() => setFilter('全部')}>全部</button>
              {availableTags.map((name) => <button key={name} className={filter === name ? 'active' : ''} onClick={() => setFilter(name)}>{name}</button>)}
              <button className="tag-add-button" onClick={() => setTagManagerOpen(true)} aria-label="编辑标签"><Plus /> 编辑标签</button>
            </div>
            {visibleItems.length ? <div className="inspiration-grid">{visibleItems.map((item) => <InspirationCard key={item.id} item={item} onClick={() => { setSelected(item); setTagDraft(item.tags.join('，')); setEditingTags(false); }} />)}</div>
              : <div className="empty-state"><Archive /><h3>还没有符合条件的灵感</h3><p>换一个标签，或者收藏一篇新的笔记。</p></div>}
          </section>
        </>}

        {view === 'projects' && openProjectId && deployment === 'pages' && workspaceEnabled && <ProjectWorkspace key={openProjectId} projectId={openProjectId} transport={fetch} onBack={() => setOpenProjectId(null)} onChanged={() => void loadData()} />}
        {view === 'projects' && (!openProjectId || deployment !== 'pages' || !workspaceEnabled) && <section className="page-section">
          <div className="section-heading">
            <div><p className="eyebrow">从灵感到现场</p><h1>拍摄项目</h1><p>把妆造、场景、姿势和光线参考收拢到一次拍摄里。</p></div>
            <Button className="save-button" onClick={() => setProjectOpen(true)}><Plus />新建项目</Button>
          </div>
          {projects.length ? <div className="project-grid">{projects.map((project) => <article className="project-card" key={project.id}>
            <div className="project-icon"><Camera /></div><small>{project.item_count} 条参考</small><h3>{project.name}</h3>
            <p>{project.description || '整理需求、参考与可执行拍摄方案。'}</p><button disabled={!workspaceEnabled || deployment !== 'pages'} onClick={() => setOpenProjectId(project.id)}>{workspaceEnabled ? '打开项目' : '工作台等待云端升级'} <ChevronRight /></button>
          </article>)}</div> : <div className="empty-state"><FolderHeart /><h3>为下一次拍摄建个项目</h3><p>例如“蓝调城市夜景”或“韩系咖啡馆写真”。</p><Button onClick={() => setProjectOpen(true)}><Plus />新建第一个项目</Button></div>}
        </section>}

        {view === 'shortcut' && <ShortcutGuide />}

        {view === 'settings' && <SettingsPage user={user} itemCount={items.length} projectCount={projects.length} onManageTags={() => setTagManagerOpen(true)} deployment={deployment} onSignOut={onSignOut} downloadEnabled={downloadEnabled} />}
      </section>

      <nav className="mobile-nav" aria-label="移动端导航">
        <NavButton active={view === 'library'} icon={<Library />} onClick={() => setView('library')}>灵感库</NavButton>
        <button className="quick-add" onClick={() => { setView('library'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} aria-label="快速收藏"><Plus /></button>
        <NavButton active={view === 'projects'} icon={<FolderHeart />} onClick={() => setView('projects')}>项目</NavButton>
      </nav>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="detail-dialog">{selected && <>
          <div className="detail-image">
            {gallery.length ? <div className="detail-gallery">{gallery.map((image) => <div key={image.id} className="media-slide">{image.content_type?.startsWith('video/') ? <video src={image.url} controls playsInline preload="metadata" aria-label={image.filename || selected.title} /> : <img src={image.url} alt={image.filename || selected.title} />}<a href={image.url} target="_blank" rel="noreferrer" className="media-open">打开原文件 / 保存到设备 <ExternalLink size={14} /></a></div>)}</div>
              : selected.coverUrl ? <img src={selected.coverUrl} alt={selected.title} />
              : <button className="upload-placeholder" onClick={() => detailFileRef.current?.click()}><Upload /><span>上传截图或照片</span><small>小红书无法下载时，截图后从相册选择</small></button>}
            <Badge>{selected.primaryTag}</Badge>
          </div>
          <DialogHeader><DialogTitle>{selected.title}</DialogTitle><DialogDescription>{selected.summary}</DialogDescription></DialogHeader>
          {editingTags ? <div className="tag-editor"><Input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} placeholder="用逗号分隔标签" /><Button size="sm" onClick={saveTags}>保存</Button></div>
            : <div className="tag-cloud">{selected.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}<Button variant="ghost" size="xs" onClick={() => setEditingTags(true)}><Pencil />编辑</Button></div>}
          <div className="detail-note"><strong>拍摄提示</strong><p>{selected.description || '可以补充你想记录的构图、服装或现场注意事项。'}</p></div>
          <input ref={detailFileRef} className="sr-only" type="file" accept="image/*" multiple onChange={(event) => void uploadImages(Array.from(event.target.files ?? []))} />
          <Button className="detail-upload-button" variant="outline" onClick={() => detailFileRef.current?.click()} disabled={uploadingImages}>
            {uploadingImages ? <LoaderCircle className="animate-spin" /> : <ImagePlus />} {uploadingImages ? '正在上传' : '补充截图 / 相册图片'}
          </Button>
          {deployment === 'pages' && downloadEnabled && selected.sourceUrl && <Button variant="outline" onClick={() => void downloadSelected()} disabled={downloadingImages || uploadingImages}>{downloadingImages ? <LoaderCircle className="animate-spin" /> : <Cloud />}{downloadingImages ? '正在下载，请稍候…' : '获取 / 重试原帖图片与视频'}</Button>}
          {detailNotice && <p role="status" className="studio-notice">{detailNotice}</p>}
          {projects.length > 0 && <select className="project-select" value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}><option value="">选择拍摄项目…</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}
          <DialogFooter>
            <Button variant="destructive" onClick={deleteSelected}><Trash2 />删除</Button>
            {selected.sourceUrl && <Button variant="outline" onClick={() => window.open(selected.sourceUrl!, '_blank', 'noopener,noreferrer')}><ArrowUpRight />查看来源</Button>}
            <Button onClick={projects.length ? addSelectedToProject : () => { setSelected(null); setProjectOpen(true); }}><Plus />{projects.length ? '加入项目' : '新建拍摄项目'}</Button>
          </DialogFooter>
        </>}</DialogContent>
      </Dialog>

      <Dialog open={projectOpen} onOpenChange={setProjectOpen}>
        <DialogContent><DialogHeader><DialogTitle>新建拍摄项目</DialogTitle><DialogDescription>先起一个清晰的名字，之后再加入灵感和拍摄清单。</DialogDescription></DialogHeader>
          <Input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="例如：蓝调城市夜景" autoFocus />
          <DialogFooter><Button onClick={createProject} disabled={!projectName.trim()}>创建项目</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tagManagerOpen} onOpenChange={setTagManagerOpen}>
        <DialogContent className="tag-manager-dialog">
          <DialogHeader><DialogTitle>管理灵感标签</DialogTitle><DialogDescription>添加新标签，或对现有标签改名、删除。修改会同步到已有收藏。</DialogDescription></DialogHeader>
          <div className="tag-create-row"><Input value={newTag} onChange={(event) => setNewTag(event.target.value)} placeholder="输入新标签" onKeyDown={(event) => event.key === 'Enter' && void addTag()} /><Button onClick={addTag} disabled={!newTag.trim()}><Plus />添加</Button></div>
          <div className="tag-manager-list">{availableTags.map((tag) => <div key={tag}>
            {renamingTag === tag ? <><Input value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} autoFocus /><Button size="sm" onClick={() => renameTag(tag)}>保存</Button><Button size="icon-sm" variant="ghost" onClick={() => setRenamingTag('')}><X /></Button></>
              : <><span>#{tag}</span><Button size="icon-sm" variant="ghost" aria-label={`重命名${tag}`} onClick={() => { setRenamingTag(tag); setRenameDraft(tag); }}><Pencil /></Button><Button size="icon-sm" variant="ghost" aria-label={`删除${tag}`} onClick={() => deleteTag(tag)}><Trash2 /></Button></>}
          </div>)}</div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function NavButton({ active, icon, onClick, children }: { active: boolean; icon: React.ReactNode; onClick: () => void; children: React.ReactNode }) {
  return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{children}</span></button>;
}

function InspirationCard({ item, onClick }: { item: Inspiration; onClick: () => void }) {
  return <button className="inspiration-card" onClick={onClick}>
    <div className="card-image">{item.coverUrl ? <img src={item.coverUrl} alt="" /> : <div className="image-placeholder"><Cloud /><span>等待上传图片</span></div>}{item.status === 'needs_upload' && <span className="status-pill">待补图</span>}</div>
    <div className="card-copy"><h3>{item.title}</h3><p>{item.summary}</p><div>{item.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}</div></div>
  </button>;
}

function SettingsPage({ user, itemCount, projectCount, onManageTags, deployment, onSignOut, downloadEnabled }: {
  user: { name: string; email: string };
  itemCount: number;
  projectCount: number;
  onManageTags: () => void;
  deployment: 'sites' | 'pages';
  onSignOut?: () => void;
  downloadEnabled: boolean;
}) {
  return <section className="page-section settings-section">
    <p className="eyebrow">个人空间</p><h1>设置</h1>
    <div className="settings-grid">
      <article className="settings-card account-settings-card">
        <div className="settings-icon"><UserRound /></div><div><small>当前账号</small><h3>{user.name}</h3><p>{user.email}</p></div>
        {deployment === 'pages' ? <button className="settings-action" onClick={onSignOut}><LogOut />退出登录</button> : <a className="settings-action" href="/signout-with-chatgpt?return_to=%2F"><LogOut />退出登录</a>}
      </article>
      <article className="settings-card">
        <div className="settings-icon"><HardDrive /></div><div><small>私人资料库</small><h3>{itemCount} 条灵感 · {projectCount} 个项目</h3><p>图片保存在你的独立云端空间，不与其他账号混合。</p></div>
      </article>
      <article className="settings-card">
        <div className="settings-icon"><Tags /></div><div><small>分类管理</small><h3>灵感标签</h3><p>添加、改名或删除标签，并同步已有收藏。</p></div>
        <button className="settings-action" onClick={onManageTags}><Pencil />管理标签</button>
      </article>
      <article className="settings-card">
        <div className="settings-icon"><ShieldCheck /></div><div><small>账号与隐私</small><h3>{deployment === 'pages' ? '独立邮箱账号' : '由 ChatGPT 安全登录'}</h3><p>{deployment === 'pages' ? '由云端身份服务验证账号，数据库与私有图片按账号隔离。' : '本站不保存密码；账号身份与登录状态由登录服务管理。'}</p></div>
      </article>
      <article className="settings-card">
        <div className="settings-icon"><Cloud /></div><div><small>媒体导入</small><h3>{downloadEnabled ? '免费云端解析 · 图片与视频' : deployment === 'pages' ? '相册 / 截图上传' : 'XHS-Downloader 兼容接口'}</h3><p>{downloadEnabled ? '保存小红书分享链接时自动尝试下载到账号私有图库。无需提交小红书密码或 Cookie，不接付费解析 API。单张图片 15 MB、单个 MP4 视频 40 MB，受限或过期链接可在详情重试；不保证所有笔记可下载。云端免费额度用尽后需等待重置。' : deployment === 'pages' ? '仅保存链接并支持上传照片，尚未连接下载后台。' : '优先调用独立下载服务；遇到链接过期或风控时，可在收藏详情中补充截图。'}</p></div>
      </article>
    </div>
    <div className="settings-note"><LockKeyhole /><div><strong>{deployment === 'pages' ? '关于资料迁移' : '关于中国大陆访问'}</strong><p>{deployment === 'pages' ? '原站的账号和收藏不会自动转入新空间。GitHub Pages 与云端服务的可达性取决于当前网络。' : '当前网址依赖 ChatGPT 登录与 chatgpt.site 网络，因此在部分大陆网络中可能无法连接。更换按钮或普通域名不能彻底解决，需要迁移到可在大陆访问的云服务并替换登录系统。'}</p></div></div>
  </section>;
}

function ShortcutGuide() {
  const steps = [
    ['创建快捷指令', '在 iPhone“快捷指令”中创建一条新指令，并打开“在共享表单中显示”。'],
    ['接收分享内容', '将接收类型设为 URL 和文本，再添加“打开 URL”操作。'],
    ['打开收藏页', '使用本站地址，并把共享内容作为 sharedText 参数传入；网站会自动填入链接，确认即可保存。'],
    ['图片受限时', '在小红书中截取需要的画面，打开已保存的收藏，点击“补充截图 / 相册图片”批量上传。'],
  ];
  return <section className="page-section shortcut-section">
    <p className="eyebrow">iPhone 快捷收藏</p><h1>从分享菜单直接送进灵感库</h1>
    <p className="lead">第一版采用“打开网站确认”的方式，不在快捷指令里保存密码，也不会读取你的浏览器账号信息。</p>
    <div className="shortcut-visual"><div><Share2 /><span>小红书分享</span></div><ChevronRight /><div><WandSparkles /><span>收藏到灵感库</span></div><ChevronRight /><div><Check /><span>确认保存</span></div></div>
    <div className="steps">{steps.map(([title, text], index) => <article key={title}><span>{index + 1}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div>
    <div className="security-note"><LockKeyhole /><div><strong>为什么需要确认一步？</strong><p>快捷指令只负责把分享内容带到网站，真正保存时仍由已登录的网站验证身份，因此链接一定会进入你的独立空间。</p></div></div>
  </section>;
}

