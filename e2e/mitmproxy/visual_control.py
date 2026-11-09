"""Shared control and request routing for visual test proxies."""

import json
from urllib.parse import urlsplit
from mitmproxy import http

CONTROL_HOST = 'test-mitmproxy.invalid'


def respond(flow, data, status=200):
    """向视觉控制流写入 JSON 结果及跨域响应头。"""
    flow.response = http.Response.make(status, json.dumps(data).encode(), {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': flow.request.headers.get('Origin', '*'),
        'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': flow.request.headers.get('Access-Control-Request-Headers', ''),
    })


def control(proxy, flow, respond, command, status):
    """验证视觉代理控制令牌并分发命令或状态读取。"""
    if flow.request.headers.get('X-E2E-Control-Token') != proxy.token:
        respond(flow, {'error': 'Forbidden'}, 403)
        return
    try:
        dispatch_command(flow, command)
    except (ValueError, KeyError, TypeError, AttributeError):
        respond(flow, {'error': 'Invalid replay command'}, 400)
        return
    respond(flow, status())


def route_request(proxy, flow, diagnostics, is_staging):
    """优先处理控制及诊断流量，判断业务请求是否属于可处理来源。"""
    if flow.response:
        return False
    if flow.request.host == CONTROL_HOST:
        route_control(proxy, flow, diagnostics)
        return False
    return route_business(proxy, flow, is_staging)


def dispatch_command(flow, command):
    """POST 执行命令，只有 GET /status 可读取状态。"""
    path = urlsplit(flow.request.path).path
    if flow.request.method == 'POST':
        command(path, json.loads(flow.request.content))
    elif (flow.request.method, path) != ('GET', '/status'):
        raise ValueError('Unknown command')


def route_control(proxy, flow, diagnostics):
    """诊断只接受精确的 GET 入口，其余控制交由代理验证。"""
    if (flow.request.method, urlsplit(flow.request.path).path) == ('GET', '/diagnostics'):
        diagnostics.control(flow)
    else:
        proxy.control(flow)


def route_business(proxy, flow, is_staging):
    """记录真实代理请求数，并限制具名视觉场景和来源。"""
    proxy.proxied_requests += 1
    return proxy.scenario == 'visual-stable' and is_staging(flow.request.host)
