"""Private-gallery import primitives. No upstream code or credentials are embedded."""
import ipaddress
import json
import socket
import time
import uuid
from collections import defaultdict, deque
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

MAX_IMAGE = 15_000_000
MAX_TOTAL = 40_000_000
MAX_IMAGES = 12
SOURCE_HOSTS = {'xiaohongshu.com', 'www.xiaohongshu.com', 'xhslink.cn', 'www.xhslink.cn', 'xhslink.com', 'www.xhslink.com'}

class ImportFailure(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status
        super().__init__(message)

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = build_opener(ProxyHandler({}), NoRedirect())

def valid_source(url):
    try:
        parsed = urlsplit(url)
        return parsed.scheme == 'https' and parsed.hostname in SOURCE_HOSTS and not parsed.username and not parsed.password and parsed.port in (None, 443) and len(url) <= 4000
    except (ValueError, TypeError):
        return False

def valid_image(url):
    try:
        parsed = urlsplit(url)
        host = parsed.hostname or ''
        return parsed.scheme == 'https' and (host.endswith('.xhscdn.com') or host.endswith('.xiaohongshu.com')) and not parsed.username and not parsed.password and parsed.port in (None, 443) and len(url) <= 8000
    except (ValueError, TypeError):
        return False

def public_dns(url):
    host = urlsplit(url).hostname
    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ImportFailure('目标地址不允许访问。')

def source_redirect(url):
    """Validate every short-link hop before allowing the upstream library to read it."""
    for _ in range(6):
        if not valid_source(url):
            raise ImportFailure('分享链接或跳转目标不是支持的小红书 HTTPS 地址。')
        public_dns(url)
        parsed = urlsplit(url)
        if parsed.hostname in ('xiaohongshu.com', 'www.xiaohongshu.com'):
            if not (parsed.path.startswith('/explore/') or parsed.path.startswith('/discovery/item/') or parsed.path.startswith('/user/profile/')):
                raise ImportFailure('请复制具体图文笔记的分享链接。')
            return url.replace('https://xiaohongshu.com/', 'https://www.xiaohongshu.com/', 1)
        try:
            with opener.open(Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=12) as response:
                # Non-redirecting short links require an updated share, not arbitrary page scripting.
                raise ImportFailure('短链接没有返回可识别的笔记地址，请重新分享或上传截图。')
        except HTTPError as error:
            if error.code not in (301, 302, 303, 307, 308):
                raise ImportFailure('分享链接已失效或暂时受限，请重新复制链接。') from None
            url = urljoin(url, error.headers.get('Location', ''))
    raise ImportFailure('分享链接跳转次数过多。')

def image_type(data):
    if data[:3] == b'\xff\xd8\xff': return 'image/jpeg'
    if data[:8] == b'\x89PNG\r\n\x1a\n': return 'image/png'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP': return 'image/webp'
    if data[:6] in (b'GIF87a', b'GIF89a'): return 'image/gif'
    if len(data) >= 12 and data[4:8] == b'ftyp':
        if data[8:12] in (b'avif', b'avis'): return 'image/avif'
        if data[8:12] in (b'heic', b'heix', b'hevc', b'hevx'): return 'image/heic'
    raise ImportFailure('下载结果不是受支持的图片，未存入图库。')

def fetch_image(url):
    for _ in range(4):
        if not valid_image(url): raise ImportFailure('图片地址不在允许的小红书图片域名中。')
        public_dns(url)
        try:
            with opener.open(Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.xiaohongshu.com/'}), timeout=15) as response:
                if int(response.headers.get('Content-Length', '0')) > MAX_IMAGE: raise ImportFailure('单张图片超过 15 MB。')
                chunks, size = [], 0
                started = time.monotonic()
                while chunk := response.read(65536):
                    size += len(chunk)
                    if size > MAX_IMAGE or time.monotonic() - started > 20: raise ImportFailure('图片过大或读取超时。')
                    chunks.append(chunk)
                data = b''.join(chunks)
                return data, image_type(data)
        except HTTPError as error:
            if error.code in (301, 302, 303, 307, 308):
                url = urljoin(url, error.headers.get('Location', ''))
            else: raise ImportFailure('图片暂时不可下载，请稍后重试或补充截图。') from None
    raise ImportFailure('图片地址跳转过多。')

def note_images(result):
    if not isinstance(result, list) or not result or not isinstance(result[0], dict):
        raise ImportFailure('未取得笔记内容。链接可能过期或受到平台限制，可重新分享或上传截图。')
    note = result[0]
    if note.get('作品类型') not in ('图文', '图集'):
        raise ImportFailure('目前仅支持图文笔记，不下载视频。')
    urls = note.get('下载地址', [])
    if not isinstance(urls, list): raise ImportFailure('下载器返回了不兼容的图片格式。')
    # Never recursively collect avatar, video or tracking URLs from a response.
    urls = list(dict.fromkeys(url for url in urls if isinstance(url, str) and valid_image(url)))
    if not urls: raise ImportFailure('这篇笔记没有可读取的图片地址。请补充截图。')
    return note, urls[:MAX_IMAGES], max(0, len(urls) - MAX_IMAGES)

class Cloud:
    def __init__(self, base, key, authorization):
        parsed = urlsplit(base)
        if parsed.scheme != 'https' or not (parsed.hostname or '').endswith('.supabase.co') or parsed.path not in ('', '/') or parsed.username or parsed.port not in (None, 443):
            raise ImportFailure('云端地址配置不正确。', 503)
        if not key.startswith('sb_publishable_'): raise ImportFailure('后台仅允许使用公开 publishable key。', 503)
        self.base, self.key, self.authorization = base.rstrip('/'), key, authorization
        self.user_id = None

    def request(self, path, method='GET', body=None, content_type='application/json', extra_headers=None):
        if not path.startswith(('/auth/v1/', '/rest/v1/', '/storage/v1/')): raise ImportFailure('不允许的云端请求。')
        payload = body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None
        headers = {'apikey': self.key, 'Authorization': self.authorization, 'Content-Type': content_type, 'Prefer': 'return=representation', **(extra_headers or {})}
        try:
            with opener.open(Request(self.base + path, data=payload, method=method, headers=headers), timeout=20) as response:
                value = response.read(2_000_000)
                return json.loads(value) if value else None
        except HTTPError as error:
            if error.code in (401, 403): raise ImportFailure('登录状态失效或没有操作权限，请重新登录。', 401) from None
            raise ImportFailure('私有图库暂时无法读写；下载结果未能全部保存。', 502) from None

    def authenticate(self):
        if not self.authorization.startswith('Bearer ') or len(self.authorization) > 10000: raise ImportFailure('请先登录。', 401)
        value = self.request('/auth/v1/user')
        try: self.user_id = str(uuid.UUID(value['id']))
        except (KeyError, ValueError, TypeError): raise ImportFailure('无法验证账号身份。', 401) from None
        return self.user_id

    def item(self, item_id):
        item_id = str(uuid.UUID(item_id))
        rows = self.request(f'/rest/v1/inspirations?id=eq.{item_id}&user_id=eq.{self.user_id}&select=*')
        if not rows: raise ImportFailure('收藏不存在或不属于当前账号。', 404)
        return rows[0]

    def images(self, item_id):
        return self.request(f'/rest/v1/inspiration_images?inspiration_id=eq.{item_id}&user_id=eq.{self.user_id}&order=position.asc')

    def save_image(self, item_id, index, position, data, content_type):
        image_id = str(uuid.uuid5(uuid.UUID(item_id), f'portrait-muse-xhs-{index}'))
        key = f'users/{self.user_id}/inspirations/{item_id}/{image_id}'
        self.request('/storage/v1/object/portrait-images/' + key, 'POST', data, content_type, {'x-upsert': 'true'})
        row = {'id': image_id, 'inspiration_id': item_id, 'user_id': self.user_id, 'storage_key': key, 'filename': f'xiaohongshu-{index + 1}', 'content_type': content_type, 'position': position}
        try:
            self.request('/rest/v1/inspiration_images?on_conflict=id', 'POST', row, extra_headers={'Prefer': 'return=representation,resolution=merge-duplicates'})
        except ImportFailure:
            self.request('/storage/v1/object/portrait-images', 'DELETE', {'prefixes': [key]})
            raise
        return key

    def finish(self, item, note, cover_key, count, skipped):
        message = f'已从原笔记保存 {count} 张图片。' + (f'另有 {skipped} 张未下载，可补充上传。' if skipped else '')
        patch = {'status': 'ready', 'cover_key': item.get('cover_key') or cover_key, 'updated_at': int(time.time() * 1000), 'summary': message}
        if title := note.get('作品标题'): patch['title'] = str(title)[:160]
        if description := note.get('作品描述'): patch['description'] = str(description)[:3000]
        result = self.request(f'/rest/v1/inspirations?id=eq.{item["id"]}&user_id=eq.{self.user_id}', 'PATCH', patch)
        if not result: raise ImportFailure('收藏可能已被删除，无法完成导入。', 409)
        return {'count': count, 'skipped': skipped, 'message': message}

class RateLimit:
    """Single-instance, process-local protection, not a durable billing quota."""
    def __init__(self): self.requests = defaultdict(deque)
    def claim(self, user_id, now=None):
        now = time.monotonic() if now is None else now
        if len(self.requests) > 5000:
            self.requests = defaultdict(deque, {k: v for k, v in self.requests.items() if v and v[-1] > now - 3600})
        entries = self.requests[user_id]
        while entries and entries[0] <= now - 3600: entries.popleft()
        if sum(x > now - 60 for x in entries) >= 3 or len(entries) >= 20: raise ImportFailure('下载请求过于频繁，请稍后再试（每分钟 3 次、每小时 20 次）。', 429)
        entries.append(now)
