import asyncio
import contextlib
import io
import json
import os
import tempfile
import time
import uuid
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from core import Cloud, ImportFailure, RateLimit, MAX_TOTAL, fetch_image, note_images, source_redirect, valid_source

UPSTREAM_COMMIT = '3261312721f0b37c705ba6515885bc7f34349f2f'
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
origin = os.environ.get('ALLOWED_ORIGIN', 'https://59rion.github.io')
app.add_middleware(CORSMiddleware, allow_origins=[origin], allow_methods=['GET', 'POST', 'OPTIONS'], allow_headers=['Authorization', 'Content-Type'])
lock = asyncio.Lock()
limiter = RateLimit()

@app.get('/health')
@app.get('/')
async def health():
    configured = bool(os.environ.get('SUPABASE_URL') and os.environ.get('SUPABASE_PUBLISHABLE_KEY'))
    return JSONResponse({'service': 'Portrait Muse · private XHS import', 'configured': configured, 'upstreamCommit': UPSTREAM_COMMIT, 'cookieRequired': False}, status_code=200 if configured else 503)

@app.post('/imports')
async def import_note(request: Request):
    cloud = None
    item = None
    saved = []
    try:
        if request.headers.get('origin') not in (None, origin): raise ImportFailure('不允许的来源。', 403)
        if int(request.headers.get('content-length', '0')) > 1024: raise ImportFailure('请求过长。', 413)
        payload = bytearray()
        async for chunk in request.stream():
            payload.extend(chunk)
            if len(payload) > 1024: raise ImportFailure('请求过长。', 413)
        body = json.loads(payload)
        if not isinstance(body, dict) or set(body) != {'inspirationId'}: raise ImportFailure('只接受已保存的收藏编号，不接受 Cookie、代理或任意网址。')
        try: item_id = str(uuid.UUID(body['inspirationId']))
        except (ValueError, TypeError, AttributeError): raise ImportFailure('收藏编号不正确。') from None
        cloud = Cloud(os.environ.get('SUPABASE_URL', ''), os.environ.get('SUPABASE_PUBLISHABLE_KEY', ''), request.headers.get('authorization', ''))
        user_id = await asyncio.to_thread(cloud.authenticate)
        item = await asyncio.to_thread(cloud.item, item_id)
        if not valid_source(item.get('source_url')): raise ImportFailure('这条收藏没有支持的小红书分享链接。')
        existing = await asyncio.to_thread(cloud.images, item_id)
        if existing:
            if not item.get('cover_key'):
                await asyncio.to_thread(cloud.finish, item, {}, existing[0]['storage_key'], len(existing), 0)
            return JSONResponse({'count': len(existing), 'skipped': 0, 'message': '这条收藏已有图片，不会自动覆盖；如需补图，请从相册上传。', 'alreadyHasImages': True})
        limiter.claim(user_id)
        if lock.locked(): raise ImportFailure('下载服务正在处理上一条笔记，请稍后重试。', 429)
        async with lock:
            started = time.monotonic()
            source_url = await asyncio.to_thread(source_redirect, item['source_url'])
            from source import XHS
            with tempfile.TemporaryDirectory(prefix='portrait-xhs-') as temporary:
                # The upstream is singleton-based, therefore extraction is strictly serialized.
                # No global account Cookie: one user's private XHS access must never be shared.
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    async with XHS(work_path=temporary, cookie='', record_data=False, download_record=False, image_format='WEBP', video_download=False, live_download=False, script_server=False, note_format='', timeout=10, max_retry=1) as xhs:
                        result = await asyncio.wait_for(xhs.extract(source_url, download=False, check_record=False), timeout=35)
            note, urls, skipped = note_images(result)
            total = 0
            for index, url in enumerate(urls):
                if time.monotonic() - started > 95:
                    skipped += len(urls) - index
                    break
                try:
                    data, content_type = await asyncio.to_thread(fetch_image, url)
                    if total + len(data) > MAX_TOTAL:
                        skipped += len(urls) - index
                        break
                    key = await asyncio.to_thread(cloud.save_image, item_id, index, index, data, content_type)
                    total += len(data)
                    saved.append(key)
                except ImportFailure:
                    skipped += 1
            if not saved: raise ImportFailure('未能下载图片。可能是链接过期或平台限制，原链接已保留，可重新分享或上传截图。')
            summary = await asyncio.to_thread(cloud.finish, item, note, saved[0], len(saved), skipped)
            return JSONResponse(summary)
    except ImportFailure as error:
        return JSONResponse({'error': error.message, 'imagesSaved': len(saved)}, status_code=error.status)
    except (asyncio.TimeoutError, TimeoutError):
        return JSONResponse({'error': '笔记读取超时，链接已保留；请稍后重试或上传截图。', 'imagesSaved': len(saved)}, status_code=504)
    except Exception:
        # Never expose upstream exceptions, which may contain signed links or request headers.
        return JSONResponse({'error': '下载未完成，链接已保留；请稍后重试或上传截图。', 'imagesSaved': len(saved)}, status_code=502)

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', '10000')), access_log=False, log_level='warning')
