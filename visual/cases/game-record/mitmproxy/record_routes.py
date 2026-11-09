"""战绩视觉夹具的精确路由，保留账号、房间批次和分页隔离。"""

from data import CLUB, HOUSE, PLAYER, all_records, detail, records, replay, rooms, round_data, settlements


def record_ids():
    """每次请求使用当前固定数据的会话集合。"""
    return {record['play_session_id'] for record in all_records()}


def game_amount(room_id):
    """空会话没有牌局，其他会话固定三局。"""
    return 0 if room_id.endswith('empty') else 3


class RecordFixtures:
    """按确切方法、路径和正文批次构建战绩读取。"""

    def fixture(self, path, method, body, query):
        """未绑定账号时不提供业务夹具。"""
        if not self.user_id:
            return None
        route = self.routes(query).get((method, path))
        if route is not None:
            return route(body)
        return self.session_fixture(path, method, body)

    def routes(self, query):
        """固定路径使用数据表，动态房间路径由独立入口处理。"""
        user = self.user_id
        return {
            # 在列表请求命中后才按当前游标构造分页。
            ('GET', f'/v10/texas_holdem/user/{user}/game_records'): lambda body: self.legacy_list(query),
            ('PUT', f'/v11/game_log/{user}/play_session_record/recent'): self.recent,
            ('PUT', '/v1/room'): self.room_batch,
            ('PUT', '/v1/game_log/room/settlement'): self.settlement_batch,
            ('PUT', '/v11/game_log/room/settlement'): self.settlement_batch,
            ('PUT', f'/v1/game_log/user/{user}/rooms/settlement'): self.user_settlements,
            # 俱乐部列表保留本次请求的账号查询。
            ('GET', '/v10/club'): lambda body: self.club_list(query),
            ('PUT', '/v10/clubs'): self.club_batch,
            ('PUT', '/v10/profile/users'): self.profile_batch,
            ('PUT', '/v1/game_log/room/game_amount'): self.amount_batch,
            ('PUT', f'/v1/game_log/user/{user}/games'): self.games,
        }

    def selected_records(self):
        """按模式选取来源，再应用删除与手数规则。"""
        return [record for record in self.source_records() if self.include_record(record)]

    def source_records(self):
        """只有分页模式使用完整长列表。"""
        return all_records() if self.mode == 'paged' else records()

    def include_record(self, record):
        """无手数模式只保留零手数会话。"""
        if record['play_session_id'] in self.deleted:
            return False
        return self.mode != 'no-hands' or record['all_round_count'] == 0

    def list_records(self):
        """空态仍采用同一固定数据来源。"""
        return [] if self.mode == 'empty' else self.selected_records()

    def legacy_list(self, query):
        """只有分页模式使用固定二十条首页和续页游标。"""
        data = self.list_records()
        if self.mode == 'paged':
            return self.paged_list(data, query)
        return self.legacy_page(data, None)

    def paged_list(self, data, query):
        """保持原有游标匹配和切片边界。"""
        if query.get('next_page') == ['visual-page-2']:
            return self.legacy_page(data[20:], None)
        return self.legacy_page(data[:20], 'visual-page-2')

    def legacy_page(self, selected, next_page):
        """旧版列表只包含房间和创建时点。"""
        return {'next_page': next_page, 'items': [
            {'room_id': item['play_session_id'], 'create_at': item['create_at']} for item in selected]}

    def recent(self, body):
        """新版列表正文必须匹配绑定账号。"""
        if body.get('user_id') == self.user_id:
            return {'records': self.list_records()}
        return None

    def session_fixture(self, path, method, body):
        """会话详情与轮次只接受已登记 ID 的 GET。"""
        prefix = f'/v11/game_log/{self.user_id}/'
        if method == 'GET' and path.startswith(prefix):
            return self.record_detail(path[len(prefix):])
        return self.room_fixture(path, method, body)

    def record_detail(self, suffix):
        """会话与轮次使用固定后缀解析。"""
        kind, _, session = suffix.partition('/')
        if kind == 'round':
            session = session.removesuffix('-round')
        if session not in record_ids():
            return None
        return self.build_detail(kind, session)

    def build_detail(self, kind, session):
        """未知会话类型保持透传。"""
        builder = {'play_session_record': detail, 'round': round_data}.get(kind)
        return builder(self.user_id, session) if builder else None

    def room_batch(self, body):
        """批量房间只能包含固定会话，缺必需字段仍传播 KeyError。"""
        if set(body.get('rooms', [])) <= record_ids():
            return {room_id: rooms()[room_id] for room_id in body['rooms']}
        return None

    def room_fixture(self, path, method, body):
        """房间资料读取与删除使用各自精确前缀。"""
        if method == 'GET' and path.startswith('/v1/room/'):
            return self.room_read(path[9:])
        return self.delete_fixture(path, method, body)

    def room_read(self, room_id):
        """只有固定私人房夹具显示为尚在开放。"""
        if room_id not in record_ids():
            return None
        room = rooms()[room_id]
        if room_id.endswith('private'):
            room.update(room_status='open', timer_status='timing', remaining_seconds=3600)
        return room

    def settlement_batch(self, body):
        """任一未知房间使整批透传。"""
        requested = body.get('room_ids', [])
        if not set(requested) <= record_ids():
            return None
        return {'rooms_settlements': {room_id: settlements(self.user_id, room_id) for room_id in requested}}

    def user_settlements(self, body):
        """用户结算保持原有单项选择和空会话过滤。"""
        requested = body.get('room_ids', [])
        if not set(requested) <= record_ids():
            return None
        return {'rooms_settlement': self.nonempty_settlements(requested)}

    def nonempty_settlements(self, requested):
        """只有存在结算的房间返回第一位玩家汇总。"""
        return [dict(settlements(self.user_id, room_id)[0], room_id=room_id)
                for room_id in requested if settlements(self.user_id, room_id)]

    def club_list(self, query):
        """俱乐部列表必须使用绑定账号的确切查询。"""
        if query.get('user_id') == [self.user_id]:
            return {'clubs': [{'id': CLUB, 'club_id': CLUB, 'name': 'Visual Club', 'room_amount': 0}]}
        return None

    def club_batch(self, body):
        """俱乐部批次只接受固定唯一俱乐部。"""
        if body.get('club_ids') == [CLUB]:
            return [{'club_id': CLUB, 'name': 'Visual Club', 'avatar': '', 'room_amount': 0}]
        return None

    def profile_batch(self, body):
        """虚拟玩家资料不混入真实玩家。"""
        if not set(body.get('users', [])) <= {PLAYER, HOUSE}:
            return None
        return {player: {'user_id': player, 'nickname': 'Opponent', 'avatarPath': ''} for player in body['users']}

    def delete_fixture(self, path, method, body):
        """删除仅匹配当前用户的固定会话。"""
        if method == 'DELETE' and path.startswith(f'/v1/game_log/user/{self.user_id}/room/'):
            return self.delete_room(path.rsplit('/', 1)[-1])
        return self.room_log(path, method, body)

    def delete_room(self, room_id):
        """删除错误模式返回空结果但保留列表。"""
        if room_id not in record_ids():
            return None
        if self.mode != 'delete-error':
            self.deleted.append(room_id)
        return {}

    def room_log(self, path, method, body):
        """日志路由按固定房间完整路径匹配。"""
        for room_id in record_ids():
            result = self.log_route(room_id, path, method, body)
            if result is not None:
                return result
        return None

    def log_route(self, room_id, path, method, body):
        """只有固定会话的三种日志读取可命中。"""
        prefix = f'/v1/game_log/room/{room_id}'
        routes = {
            # 按命中的固定房间计算牌局数。
            ('GET', prefix + '/game_amount'): lambda: {'game_amount': game_amount(room_id)},
            # 牌局列表只在对应路由命中后读取正文。
            ('PUT', prefix + '/game'): lambda: self.room_games(room_id, body),
            # 结算按当前用户与命中的房间延迟构造。
            ('GET', prefix + '/settlement'): lambda: {'settlements': settlements(self.user_id, room_id)},
        }
        build = routes.get((method, path))
        return build() if build else None

    def room_games(self, room_id, body):
        """空会话不读取 game_numbers，其他会话按原序返回。"""
        if room_id.endswith('empty'):
            return {'results': []}
        return {'results': [{'game_id': f'{room_id}-game-{i}', 'game_number': i} for i in body['game_numbers']]}

    def amount_batch(self, body):
        """批量牌局数仅接受固定会话集合。"""
        if not set(body.get('room_ids', [])) <= record_ids():
            return None
        return {'results': [{'room_id': room_id, 'game_amount': game_amount(room_id)} for room_id in body['room_ids']]}

    def games(self, body):
        """任一未知牌局使整个重放批次透传。"""
        game_ids = body.get('game_ids', [])
        if not set(game_ids) <= self.allowed_games():
            return None
        return {'results': [self.game_replay(game_id) for game_id in game_ids]}

    def allowed_games(self):
        """固定三局的完整 ID 集合。"""
        return {f'{session}-game-{i}' for session in record_ids() for i in range(1, 4)}

    def game_replay(self, game_id):
        """按原有后缀解析局号与会话。"""
        return replay(self.user_id, int(game_id.rsplit('-', 1)[-1]), game_id.rsplit('-game-', 1)[0])
