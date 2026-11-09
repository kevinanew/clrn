"""视觉代理共用的本地预检与真实建房验证，按测试支持预算检查。"""

import os
from urllib.parse import urlsplit


def local_release_origin():
    """只接受本轮本地 HTTP Release 地址，非法端口保持透传。"""
    try:
        release = urlsplit(os.environ.get('CLRN_RELEASE_WEB_URL', ''))
        return release_origin(release)
    except ValueError:
        return None


def release_origin(release):
    """本地 URL 必须显式设置端口。"""
    if release.scheme != 'http' or release.hostname != '127.0.0.1':
        return None
    return clean_origin(release)


def clean_origin(release):
    """拒绝认证信息、额外路径及查询。"""
    if not release.port or has_url_extras(release):
        return None
    return f'http://127.0.0.1:{release.port}'


def has_url_extras(release):
    """认证信息和 URL 后缀不属于允许的本地来源。"""
    return any((release.username, release.password, release.path not in ('', '/'),
                release.query, release.fragment))


def is_read_preflight(flow):
    """只处理明确请求 GET 的 OPTIONS。"""
    return flow.request.method == 'OPTIONS' and flow.request.headers.get('Access-Control-Request-Method') == 'GET'


def preflight_headers(flow):
    """未知头继续交由上游判断。"""
    requested = flow.request.headers.get('Access-Control-Request-Headers', '')
    names = {name.strip().lower() for name in requested.split(',')}
    allowed = {'accept', 'accept-language', 'content-type', 'app-id', 'app-version', 'authorization'}
    if not names <= allowed:
        return None
    return requested


def preflight_response(flow, response_factory):
    """来源和请求头均合法后才响应，不改变跨域允许范围。"""
    origin = local_release_origin()
    if flow.request.headers.get('Origin') != origin or origin is None:
        return False
    return send_preflight(flow, origin, response_factory)


def send_preflight(flow, origin, response_factory):
    """保持原有响应状态、认证许可和 Vary 头。"""
    requested = preflight_headers(flow)
    if requested is None:
        return False
    flow.response = response_factory(204, b'', {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': requested,
        'Vary': 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
    })
    return True


def creation_action(request):
    """只接受对象形式的动作和建房配置。"""
    action = request.get('action_url')
    config = request.get('action_json')
    if not isinstance(action, dict) or not isinstance(config, dict):
        return False
    return is_create_action(action)


def is_create_action(action):
    """保留服务端两个建房占位符路径。"""
    paths = ('/v2/building/$building_id$/room', '/v2/building/<building_id>/room')
    return action.get('method') == 'POST' and action.get('path') in paths


def successful_result(body):
    """只有 ok=true 的对象 result 可用于稳定字段和绑定。"""
    result = body.get('result')
    if body.get('ok') is not True or not isinstance(result, dict):
        return None
    return result


def successful_flow(flow):
    """真实 HTTP 200 响应才可用于观察或覆盖。"""
    return flow.response and flow.response.status_code == 200


class VisualCommands:
    """德州和拼三张共同的场景与释放控制生命周期。"""

    def command(self, path, body):
        """场景命令优先，其余按活动状态和确切路径处理。"""
        if self.scenario_command(path, body):
            return
        self.game_command(path, body)

    def scenario_command(self, path, body):
        """仅接受原有两种场景，切换后释放玩法全部绑定。"""
        if path == '/scenario' and body.get('scenario') in (None, 'visual-stable'):
            self.scenario = body['scenario']
            self.release()
            return True
        return False

    def game_command(self, path, body):
        """释放不要求活动场景，其余命令保留原拒绝语义。"""
        if path == self.release_path:
            self.release()
            return
        if self.scenario != 'visual-stable':
            raise ValueError('Unknown command')
        self.active_command(path, body)
