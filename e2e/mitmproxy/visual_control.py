"""Shared control and request routing for visual test proxies."""

import json
from urllib.parse import urlsplit
from mitmproxy import http

CONTROL_HOST = 'test-mitmproxy.invalid'


def respond(flow, data, status=200):
    flow.response = http.Response.make(status, json.dumps(data).encode(), {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': flow.request.headers.get('Origin', '*'),
        'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': flow.request.headers.get('Access-Control-Request-Headers', ''),
    })


def control(proxy, flow, respond, command, status):
    if flow.request.headers.get('X-E2E-Control-Token') != proxy.token:
        respond(flow, {'error': 'Forbidden'}, 403)
        return
    path = urlsplit(flow.request.path).path
    try:
        if flow.request.method == 'POST':
            command(path, json.loads(flow.request.content))
        elif flow.request.method != 'GET' or path != '/status':
            raise ValueError('Unknown command')
    except (ValueError, KeyError, TypeError, AttributeError):
        respond(flow, {'error': 'Invalid replay command'}, 400)
        return
    respond(flow, status())


def route_request(proxy, flow, diagnostics, is_staging):
    if flow.response:
        return False
    if flow.request.host == CONTROL_HOST:
        if flow.request.method == 'GET' and urlsplit(flow.request.path).path == '/diagnostics':
            diagnostics.control(flow)
        else:
            proxy.control(flow)
        return False
    proxy.proxied_requests += 1
    return proxy.scenario == 'visual-stable' and is_staging(flow.request.host)
