"""Offline tests with synthetic data; never contacts XHS, Render or Supabase."""
import asyncio
import contextlib
import importlib
import json
import os
import sys
import types
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
import core

class CoreTests(unittest.TestCase):
    def test_hosts_and_schemes(self):
        self.assertTrue(core.valid_source('https://xhslink.cn/o/test'))
        self.assertTrue(core.valid_image('https://sns-webpic.xhscdn.com/notes/picture'))
        for url in ['http://xhslink.cn/o/test', 'https://xhslink.cn.evil.test/o/a', 'https://localhost/a', 'https://user:password@xhslink.cn/o/a', 'https://xhslink.cn:444/a', 'file:///etc/passwd']:
            self.assertFalse(core.valid_source(url))
        for url in ['https://evil.test/a.jpg', 'https://cdn.xhscdn.com.evil.test/a', 'http://cdn.xhscdn.com/a', 'https://user@cdn.xhscdn.com/a', 'https://127.0.0.1/a']:
            self.assertFalse(core.valid_image(url))

    def test_magic_bytes(self):
        self.assertEqual(core.image_type(b'\xff\xd8\xffdata'), 'image/jpeg')
        self.assertEqual(core.image_type(b'\x89PNG\r\n\x1a\n'), 'image/png')
        with self.assertRaises(core.ImportFailure): core.image_type(b'<svg><script>bad</script></svg>')
        with self.assertRaises(core.ImportFailure): core.image_type(b'<!doctype html>blocked')

    def test_exact_note_image_list(self):
        result = [{'作品类型': '图文', '下载地址': ['https://cdn.xhscdn.com/a', 'https://cdn.xhscdn.com/a', 'https://evil.test/a'], 'avatar': 'https://cdn.xhscdn.com/avatar'}]
        _, images, skipped = core.note_images(result)
        self.assertEqual(images, ['https://cdn.xhscdn.com/a'])
        self.assertEqual(skipped, 0)
        with self.assertRaises(core.ImportFailure): core.note_images([{'作品类型': '视频', '下载地址': ['https://cdn.xhscdn.com/a']}])
        with self.assertRaises(core.ImportFailure): core.note_images([])

    def test_redirect_and_private_dns_denial(self):
        with patch.object(core, 'public_dns'), patch.object(core.opener, 'open', side_effect=HTTPError('https://xhslink.cn/a', 302, 'redirect', {'Location': 'https://127.0.0.1/private'}, None)):
            with self.assertRaises(core.ImportFailure): core.source_redirect('https://xhslink.cn/a')
        with patch.object(core.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('127.0.0.1', 443))]):
            with self.assertRaises(core.ImportFailure): core.public_dns('https://cdn.xhscdn.com/a')

    def test_limits(self):
        limiter = core.RateLimit()
        for n in range(3): limiter.claim('a', n)
        with self.assertRaises(core.ImportFailure): limiter.claim('a', 4)
        limiter.claim('b', 4)
        limiter = core.RateLimit()
        for n in range(20): limiter.claim('a', n * 61)
        with self.assertRaises(core.ImportFailure): limiter.claim('a', 20 * 61)

    def test_admin_key_refused(self):
        with self.assertRaises(core.ImportFailure): core.Cloud('https://test.supabase.co', 'sb_secret_test', 'Bearer synthetic')
        with self.assertRaises(core.ImportFailure): core.Cloud('https://evil.test', 'sb_publishable_test', 'Bearer synthetic')

    def test_cloud_owner_path(self):
        cloud = core.Cloud('https://test.supabase.co', 'sb_publishable_test', 'Bearer synthetic')
        cloud.user_id = '11111111-1111-1111-1111-111111111111'
        with patch.object(cloud, 'request', return_value=[]) as request:
            with self.assertRaises(core.ImportFailure): cloud.item('22222222-2222-2222-2222-222222222222')
            self.assertIn('user_id=eq.' + cloud.user_id, request.call_args.args[0])

# Simulate only framework routing/response containers to test handler logic offline.
# These stubs do not validate the actual FastAPI installation or live HTTP behavior.
class FakeFastAPI:
    def __init__(self, **kwargs): pass
    def add_middleware(self, *args, **kwargs): pass
    def get(self, *args, **kwargs): return lambda fn: fn
    def post(self, *args, **kwargs): return lambda fn: fn
class FakeResponse:
    def __init__(self, value, status_code=200): self.value, self.status_code, self.fixture_error = value, status_code, str(sys.exception())
class FakeRequest:
    def __init__(self, body, auth='Bearer synthetic', origin='https://59rion.github.io'):
        self.headers = {'authorization': auth, 'origin': origin}
        self.body = json.dumps(body).encode()
    async def stream(self): yield self.body

framework = types.ModuleType('fastapi'); framework.FastAPI = FakeFastAPI; framework.Request = FakeRequest
cors = types.ModuleType('fastapi.middleware.cors'); cors.CORSMiddleware = object
responses = types.ModuleType('fastapi.responses'); responses.JSONResponse = FakeResponse
with patch.dict(sys.modules, {'fastapi': framework, 'fastapi.middleware': types.ModuleType('fastapi.middleware'), 'fastapi.middleware.cors': cors, 'fastapi.responses': responses}):
    main = importlib.import_module('main')

ITEM = '22222222-2222-2222-2222-222222222222'
class HandlerTests(unittest.TestCase):
    def setUp(self):
        self.saved = []
        self.extracts = []
        self.existing = []
        self.cover = None
        self.foreign = False
        self.notes = [{'作品类型': '图文', '作品标题': '测试图文', '下载地址': ['https://cdn.xhscdn.com/a']}]
        current = self
        class FakeCloud:
            def __init__(self, base, key, authorization): self.auth = authorization
            def authenticate(self):
                if not self.auth: raise core.ImportFailure('请先登录。', 401)
                return 'test-user'
            def item(self, item_id):
                if current.foreign: raise core.ImportFailure('不属于当前账号', 404)
                return {'id': item_id, 'source_url': 'https://www.xiaohongshu.com/explore/test', 'cover_key': current.cover}
            def images(self, item_id): return current.existing
            def save_image(self, *args): current.saved.append(args); return 'users/test/owned-key'
            def finish(self, item, note, key, count, skipped): return {'count': count, 'skipped': skipped, 'message': '已保存'}
        class FakeXHS:
            def __init__(self, **kwargs): current.kwargs = kwargs
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def extract(self, *args, **kwargs): current.extracts.append(args); return current.notes
        source = types.ModuleType('source'); source.XHS = FakeXHS
        async def inline_thread(function, *args): return function(*args)
        async def inline_wait(coroutine, **kwargs): return await coroutine
        # No event loop, sockets or threads are used by this offline logic harness.
        # Timeouts/concurrency and actual framework behavior need live-container QA.
        self.patches = [patch.object(main, 'Cloud', FakeCloud), patch.object(main, 'limiter', core.RateLimit()), patch.object(main, 'source_redirect', lambda url: url), patch.object(main, 'fetch_image', lambda url: (b'\xff\xd8\xfftest', 'image/jpeg')), patch.dict(sys.modules, {'source': source}), patch.object(main.asyncio, 'to_thread', inline_thread), patch.object(main.asyncio, 'wait_for', inline_wait), patch.object(main.tempfile, 'TemporaryDirectory', lambda **kwargs: contextlib.nullcontext('synthetic-test-directory'))]
        for p in self.patches: p.start(); self.addCleanup(p.stop)

    def send(self, body=None, **kwargs):
        coroutine = main.import_note(FakeRequest(body or {'inspirationId': ITEM}, **kwargs))
        try:
            coroutine.send(None)
        except StopIteration as result:
            return result.value
        finally:
            coroutine.close()
        raise AssertionError('Offline handler fixture unexpectedly required live asynchronous IO')

    def test_import_owned_note(self):
        response = self.send()
        self.assertEqual(response.status_code, 200, response.fixture_error)
        self.assertEqual(response.value['count'], 1)
        self.assertEqual(len(self.saved), 1)
        self.assertEqual(self.kwargs['cookie'], '')
        self.assertFalse(self.kwargs['script_server'])

    def test_anonymous_and_foreign_rejected_before_extract(self):
        self.assertEqual(self.send(auth='').status_code, 401)
        self.foreign = True
        self.assertEqual(self.send().status_code, 404)
        self.assertFalse(self.extracts)
        self.assertFalse(self.saved)

    def test_arbitrary_payload_refused(self):
        self.assertEqual(self.send({'inspirationId': ITEM, 'url': 'https://evil.test'}).status_code, 400)
        self.assertEqual(self.send(origin='https://evil.test').status_code, 403)
        self.assertFalse(self.extracts)

    def test_no_overwrite(self):
        self.existing = [{'storage_key': 'users/test/existing'}]
        self.cover = 'users/test/existing'
        response = self.send()
        self.assertTrue(response.value['alreadyHasImages'])
        self.assertFalse(self.saved)
        self.assertFalse(self.extracts)

    def test_failure_and_partial_import(self):
        self.notes = []
        response = self.send()
        self.assertEqual(response.status_code, 400, response.fixture_error)
        self.assertFalse(self.saved)
        self.notes = [{'作品类型': '图文', '下载地址': ['https://cdn.xhscdn.com/a', 'https://cdn.xhscdn.com/b']}]
        with patch.object(main, 'fetch_image', side_effect=[core.ImportFailure('restricted'), (b'\xff\xd8\xfftest', 'image/jpeg')]):
            response = self.send()
        self.assertEqual(response.value['count'], 1)
        self.assertEqual(response.value['skipped'], 1)

if __name__ == '__main__': unittest.main()
