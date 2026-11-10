"""只为已有虚拟玩家只读夹具处理本轮页面的跨域预检。"""

import sys
from pathlib import Path
from urllib.parse import urlsplit
from mitmproxy import http
from texas_replay import TABLE_PLAYER_IDS

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from fixture_protocol import is_read_preflight, preflight_response  # noqa: E402

READ_PATHS = {path for player in TABLE_PLAYER_IDS for path in (
    f'/v10/profile/{player}', f'/v10/wallet/{player}/currency/coin',
    f'/v1/texas_statistics/player/{player}/rounds/100',
    f'/v1/texas_statistics/player/{player}/rounds/1000',
)}


def respond_virtual_player_preflight(flow, room_id, self_id=None):
    """只为当前房间已有的虚拟玩家或结算读取夹具响应预检。"""
    if not room_id or urlsplit(flow.request.path).path not in READ_PATHS:
        return respond_settlement_preflight(flow, room_id, self_id)
    return respond_read_preflight(flow)


def respond_read_preflight(flow):
    """请求方法、来源和头全部通过后才应答。"""
    if not is_read_preflight(flow):
        return False
    return preflight_response(flow, http.Response.make)


def respond_settlement_preflight(flow, room_id, self_id):
    """复用只读预检校验，仅覆盖已有结算 GET 夹具的确切绑定路径。"""
    if not all((room_id, self_id)):
        return False
    if urlsplit(flow.request.path).path != f'/v1/game_log/room/{room_id}/settlement':
        return False
    return respond_read_preflight(flow)
