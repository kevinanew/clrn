"""只为已有虚拟玩家只读夹具处理本轮页面的跨域预检。"""

import os
from urllib.parse import urlsplit
from mitmproxy import http
from texas_replay import TABLE_PLAYER_IDS

READ_PATHS = {path for player in TABLE_PLAYER_IDS for path in (
    f'/v10/profile/{player}', f'/v10/wallet/{player}/currency/coin',
    f'/v1/texas_statistics/player/{player}/rounds/100',
    f'/v1/texas_statistics/player/{player}/rounds/1000',
)}


def respond_virtual_player_preflight(flow, room_id):
    """房间及接口主机由调用边界核验；不放行真实用户、写入或未知请求头。"""
    if (not room_id or flow.request.method != 'OPTIONS'
            or urlsplit(flow.request.path).path not in READ_PATHS
            or flow.request.headers.get('Access-Control-Request-Method') != 'GET'):
        return False
    try:
        release = urlsplit(os.environ.get('CLRN_RELEASE_WEB_URL', ''))
        if (release.scheme != 'http' or release.hostname != '127.0.0.1' or not release.port
                or release.username or release.password or release.path not in ('', '/')
                or release.query or release.fragment):
            return False
        origin = f'http://127.0.0.1:{release.port}'
    except ValueError:
        return False
    if flow.request.headers.get('Origin') != origin:
        return False
    requested_headers = flow.request.headers.get('Access-Control-Request-Headers', '')
    names = {name.strip().lower() for name in requested_headers.split(',')}
    if not names <= {'accept', 'accept-language', 'content-type', 'app-id', 'app-version', 'authorization'}:
        return False
    flow.response = http.Response.make(204, b'', {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': requested_headers,
        'Vary': 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
    })
    return True
