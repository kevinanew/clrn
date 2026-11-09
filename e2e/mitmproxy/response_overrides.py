"""视觉代理只覆盖必要字段；真实错误、响应头和新增字段继续交给客户端。"""

import json
import os
import logging
from urllib.parse import urlsplit


def configured_hosts():
    """验证配置形状，避免字符串或混合类型被误作主机集合。"""
    hosts = json.loads(os.environ.get('MITMPROXY_API_HOSTS', '[]'))
    if not isinstance(hosts, list):
        return []
    return valid_hosts(hosts)


def is_staging(host):
    """只接受本轮明确配置的确切主机；缺少或损坏配置时默认透传。"""
    try:
        return host in configured_hosts()
    except (ValueError, TypeError):
        return False


def successful_response(flow):
    """仅接受真实 HTTP 200 响应。"""
    return bool(flow.response) and flow.response.status_code == 200


def successful_body(body):
    """校验成功业务信封，其他结构保持原样。"""
    return isinstance(body, dict) and body.get('ok') is True


def changed_body(body, change):
    """验证可修改结果并调用具体字段修改器。"""
    result = body.get('result')
    if not isinstance(result, dict):
        raise ValueError('Expected result object')
    return change(result)


def write_body(flow, body):
    """写回结果并删除已失效的校验值，保留其他响应头。"""
    flow.response.content = json.dumps(body).encode()
    for header in ('ETag', 'Content-MD5', 'Digest'):
        flow.response.headers.pop(header, None)


def apply_change(flow, change):
    """结构正确且修改器确认修改时才写回响应。"""
    body = flow.response.json()
    if not successful_body(body):
        return False
    if not changed_body(body, change):
        return False
    write_body(flow, body)
    return True


def patch_result(flow, change):
    """change 原地修改成功响应的 result；结构变化时保留原文并提示，禁止兜底成功。"""
    if not successful_response(flow):
        return False
    try:
        return apply_change(flow, change)
    except (ValueError, TypeError, KeyError, AttributeError):
        logging.warning('Visual override skipped: response contract changed at %s',
                        urlsplit(flow.request.path).path)
        return False


def patch_version(flow, version):
    """校验真实响应结构后替换可用战绩版本字段。"""
    def change(result):
        """要求版本字段为字符串后写入目标版本。"""
        if not isinstance(result.get('available_url_version'), str):
            raise ValueError('Expected version string')
        result['available_url_version'] = version
        return True
    return patch_result(flow, change)


def profile_request(flow, self_id):
    """先验证本人标识，再限制真实批量资料接口和读取方法。"""
    if not isinstance(self_id, str) or not self_id:
        return False
    return all((flow.request.method == 'PUT',
                urlsplit(flow.request.path).path == '/v10/profile/users'))


def owned_users(users, self_id, virtual_ids):
    """要求列表含本人且所有标识均属于本人或具名虚拟玩家。"""
    if not isinstance(users, list):
        return False
    return self_id in users and set(users) <= {self_id, *virtual_ids}


def prepare_profile_batch(flow, self_id, virtual_ids):
    """验证混合批次并仅向上游查询真实本人。"""
    body = flow.request.json()
    users = body.get('users')
    if not owned_users(users, self_id, virtual_ids):
        return False
    if not set(users) & set(virtual_ids):
        return False
    flow.metadata['visual_profile_users'] = users
    body['users'] = [self_id]
    flow.request.content = json.dumps(body).encode()
    return True


def prepare_profiles(flow, self_id, virtual_ids):
    """混合批次只向上游查询真实本人，虚拟 UUID 不会导致真实接口返回找不到用户。"""
    if not profile_request(flow, self_id):
        return False
    try:
        return prepare_profile_batch(flow, self_id, virtual_ids)
    except (ValueError, TypeError, AttributeError):
        return False


def selected_profiles(flow, self_id, profiles):
    """从已登记批次选择虚拟玩家；无关账号批次保持透传。"""
    users = flow.metadata.get('visual_profile_users', flow.request.json().get('users'))
    if not owned_users(users, self_id, profiles):
        return {}
    return matching_profiles(profiles, users)


def merge_profile(result, user, profile):
    """保留上游新增字段，覆盖具名虚拟玩家展示字段。"""
    result[user] = {**(result.get(user) or {}), **profile}


def patch_selected_profiles(flow, self_id, selected):
    """要求本人资料真实存在后才补充所选虚拟对手。"""
    def change(result):
        """保留本人真实资料，仅补充选定虚拟对手的资料。"""
        if not isinstance(result.get(self_id), dict):
            raise ValueError('Missing current user profile')
        for user, profile in selected.items():
            merge_profile(result, user, profile)
        return True
    return patch_result(flow, change)


def patch_profiles(flow, self_id, profiles):
    """混合批次从真实接口取得本人资料，仅补入回放虚拟玩家；其他账号批次透传。"""
    if not profile_request(flow, self_id):
        return False
    try:
        selected = selected_profiles(flow, self_id, profiles)
    except (ValueError, TypeError, AttributeError):
        return False
    return patch_nonempty_profiles(flow, self_id, selected)


def valid_hosts(hosts):
    """只保留全为字符串的主机配置。"""
    return hosts if all(isinstance(item, str) for item in hosts) else []


def matching_profiles(profiles, users):
    """选出当前批次中登记的虚拟玩家。"""
    return {user: profile for user, profile in profiles.items() if user in users}


def patch_nonempty_profiles(flow, self_id, selected):
    """无虚拟资料时保留响应原文。"""
    return patch_selected_profiles(flow, self_id, selected) if selected else False
