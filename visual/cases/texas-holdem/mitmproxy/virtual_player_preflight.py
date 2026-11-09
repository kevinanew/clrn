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


def respond_virtual_player_preflight(flow, room_id):
    """只为当前房间的已登记虚拟玩家读取响应预检。"""
    if not room_id or urlsplit(flow.request.path).path not in READ_PATHS:
        return False
    return respond_read_preflight(flow)


def respond_read_preflight(flow):
    """请求方法、来源和头全部通过后才应答。"""
    if not is_read_preflight(flow):
        return False
    return preflight_response(flow, http.Response.make)
