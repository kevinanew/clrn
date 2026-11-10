"""验证列表诊断不泄露账号、查询游标或记录正文，也不改变夹具。"""

import unittest
from list_diagnostics import observe_list


class ListDiagnosticsTests(unittest.TestCase):
    """验证有界摘要和诊断异常隔离。"""

    def test_bounded_private_summary_preserves_fixture(self):
        """仅保存模式与计数，不保存用户路径、游标和记录内容。"""
        history = []
        fixture = {'items': [{'room_id': 'private-room'}], 'next_page': 'private-cursor'}
        for _ in range(40):
            observe_list(history, '/v10/texas_holdem/user/private-user/game_records',
                         {'next_page': ['private-cursor']}, 'paged', fixture)
        self.assertEqual(len(history), 30)
        self.assertEqual(history[-1], {'mode': 'paged', 'nextPage': True,
                                      'items': 1, 'hasNextPage': True})
        self.assertNotIn('private', str(history))
        self.assertEqual(fixture['items'], [{'room_id': 'private-room'}])
        self.assertEqual(fixture['next_page'], 'private-cursor')

    def test_failure_does_not_escape(self):
        """错误诊断输入不能覆盖业务请求结果。"""
        observe_list(None, '/game_records', {}, 'list', {})
        history = []
        observe_list(history, '/unrelated', {}, 'list', {})
        observe_list(history, '/game_records', {}, 'list', None)
        self.assertEqual(history, [])
