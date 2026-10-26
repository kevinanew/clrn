"""验证真实响应的未知字段、压缩、错误和契约变化都不会被 mock 掩盖。"""

import json
import unittest
from mitmproxy import http
from response_overrides import prepare_profiles, patch_profiles, patch_version
from test_network_faults import flow


class ResponseOverrideTests(unittest.TestCase):
    def metadata(self, body, status=200, method='GET', host='api.shafayouxi.org', path='/public/v11/game_log/available.json'):
        request = flow(f'https://{host}{path}', method)
        request.response = http.Response.make(status, json.dumps(body).encode(), {
            'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://app.test',
            'X-Upstream': 'kept', 'ETag': 'old',
        })
        return request

    def test_字段覆盖保留压缩响应与未知字段(self):
        request = self.metadata({'ok': True, 'trace': 'retained', 'result': {
            'available_url_version': 'v1', 'new_field': 42}})
        request.response.encode('gzip')
        self.assertTrue(patch_version(request, 'v11'))
        self.assertEqual(request.response.json(), {'ok': True, 'trace': 'retained', 'result': {
            'available_url_version': 'v11', 'new_field': 42}})
        self.assertEqual(request.response.headers['Content-Encoding'], 'gzip')
        self.assertEqual(request.response.headers['X-Upstream'], 'kept')
        self.assertNotIn('ETag', request.response.headers)
        self.assertEqual(int(request.response.headers['Content-Length']), len(request.response.raw_content))

    def test_version_keeps_new_fields_and_does_not_recreate_removed_fields(self):
        request = self.metadata({'ok': True, 'result': {'available_url_version': 'v1', 'new': 42}})
        self.assertTrue(patch_version(request, 'v11'))
        self.assertEqual(request.response.json()['result'], {'available_url_version': 'v11', 'new': 42})
        for result in ({'new_version_field': 'v12'}, {'available_url_version': ['v12']}):
            request = self.metadata({'ok': True, 'result': result})
            original = request.response.content
            self.assertFalse(patch_version(request, 'v11'))
            self.assertEqual(request.response.content, original)

    def test_mixed_profiles_keep_current_account_real_and_only_add_requested_virtual_players(self):
        profiles = {'virtual': {'nickname': 'Opponent'}, 'unrequested': {'nickname': 'Other'}}
        request = flow('https://api.shafayouxi.org/v10/profile/users', 'PUT',
                       b'{"users":["self","virtual"]}')
        real = {'nickname': 'Real name', 'user_level': {'new': 12}, 'new_field': 42}
        request.response = http.Response.make(200, json.dumps({'ok': True, 'result': {'self': real,
            'virtual': {'new_field': 'preserved'}}}).encode())
        self.assertTrue(prepare_profiles(request, 'self', profiles))
        self.assertEqual(request.request.json(), {'users': ['self']})
        self.assertTrue(patch_profiles(request, 'self', profiles))
        self.assertEqual(request.response.json()['result'], {'self': real,
            'virtual': {'new_field': 'preserved', 'nickname': 'Opponent'}})
        for content in (b'{"users":["self","unknown","virtual"]}', b'{"users":["self"]}', b'[]', b'{'):
            request.metadata.clear()
            request.request.content = content
            original = request.response.content
            self.assertFalse(prepare_profiles(request, 'self', profiles))
            self.assertEqual(request.request.content, content)
            self.assertFalse(patch_profiles(request, 'self', profiles))
            self.assertEqual(request.response.content, original)


if __name__ == '__main__':
    unittest.main()
