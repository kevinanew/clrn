"""只允许登记本轮真实登录后创建的目标玩法房间，用于失败清理。"""

import json
import unittest
from types import SimpleNamespace
from game_session import GameSession

USER = '10000000-0000-0000-0000-000000000001'
ROOM = '20000000-0000-0000-0000-000000000001'


def flow(path, result, request=None, ok=True):
    return SimpleNamespace(request=SimpleNamespace(method='POST', path=path,
        pretty_url='https://api.shafayouxi.org' + path, content=json.dumps(request).encode()),
        response=SimpleNamespace(status_code=200, json=lambda: {'ok': ok, 'result': result}))


def login():
    return flow('/public/v10/user/login/username/password', {'user_id': USER, 'username': 'test-only',
        'api_token': {'token_type': 'Bearer', 'access_token': 'test-token'}})


def room(game='texas_holdem', room_id=ROOM):
    return flow('/v3/pay_action/do', {'room_id': room_id}, {
        'action_url': {'method': 'POST', 'path': '/v2/building/$building_id$/room'},
        'action_json': {'game_type': game}})


class GameSessionTests(unittest.TestCase):
    def test_only_first_created_target_room_is_owned(self):
        session = GameSession('texas_holdem')
        session.response(room())
        self.assertIsNone(session.room)
        session.response(login())
        session.response(room('zhajinhua'))
        session.response(room(room_id='not-a-uuid'))
        self.assertIsNone(session.room)
        session.response(room())
        session.response(room(room_id=USER))
        self.assertEqual(session.room, {'roomId': ROOM, 'apiOrigin': 'https://api.shafayouxi.org',
            'authorization': 'Bearer test-token'})

    def test_failed_and_malformed_responses_never_create_ownership(self):
        session = GameSession('texas_holdem')
        failed = login()
        failed.response.status_code = 401
        session.response(failed)
        self.assertIsNone(session.account)
        session.response(login())
        for result in (None, [], {'room_id': None}):
            session.response(flow('/v3/pay_action/do', result))
        failed = room()
        failed.response.json = lambda: {'ok': False, 'result': {'room_id': ROOM}}
        session.response(failed)
        self.assertIsNone(session.room)


if __name__ == '__main__':
    unittest.main()
