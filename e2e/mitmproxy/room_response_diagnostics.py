"""只读采集建房价格响应的有限分类，区分上游错误页与浏览器 CORS 拒收。"""

import hashlib
import re
from urllib.parse import urlsplit


def price_response_fields(flow):
    """仅观察本轮失败接口；取证异常不影响响应，不输出正文或任意响应头。"""
    try:
        if urlsplit(flow.request.path).path != '/v3/pay_action/batch/price':
            return {}
        return response_fields(flow)
    except Exception:
        return {'priceResponseDiagnostic': 'unavailable'}


def response_fields(flow):
    """保留成功响应对照，仅对 HTTP 错误计算正文指纹。"""
    response = flow.response
    fields = {'priceCorsOrigin': cors_origin(flow), 'priceServer': server_family(response)}
    if response.status_code >= 400:
        fields.update(error_body_fields(response))
    return fields


def cors_origin(flow):
    """只输出允许来源与请求来源的匹配分类，不保存来源本身。"""
    allowed = flow.response.headers.get('access-control-allow-origin')
    if allowed is None:
        return 'absent'
    if allowed == '*':
        return 'wildcard'
    return origin_match(allowed, flow.request.headers.get('origin'))


def origin_match(allowed, origin):
    """缺少请求来源时不声称 CORS 匹配。"""
    return 'matched' if origin and allowed == origin else 'mismatch'


def server_family(response):
    """服务标识仅输出固定服务族，不保存版本或其他头。"""
    server = response.headers.get('server', '')
    family = re.match(r'^(nginx|envoy|cloudflare|gunicorn|werkzeug|aiohttp)(?:[\s/]|$)', server, re.I)
    return family[1].lower() if family else 'unknown'


def error_body_fields(response):
    """仅读取已有响应，保留字节数、指纹及固定错误页分类。"""
    body = response.get_content(strict=False)
    if body is None:
        return {'priceErrorBody': 'unavailable'}
    page = re.search(rb'<(?:title|h1)>\s*(?:502\s+)?Bad Gateway\s*</', body, re.I)
    return {'priceErrorBytes': len(body), 'priceErrorFingerprint': hashlib.sha256(body).hexdigest(),
            'priceErrorPage': 'bad-gateway' if page else 'unknown'}
