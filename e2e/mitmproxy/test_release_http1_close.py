"""锁定代理的真实 HTTP/1 状态机对照，不依赖 FIN 到达顺序或外部网络。"""
import unittest
from proxy_test_support import instances, event_objects
from mitmproxy import connection, http, options
from mitmproxy.proxy import commands, events
from mitmproxy.proxy.context import Context
from mitmproxy.proxy.layers.http._base import ReceiveHttp
from mitmproxy.proxy.layers.http._events import (
    RequestHeaders, RequestEndOfMessage, ResponseData, ResponseEndOfMessage, ResponseProtocolError,
)
from mitmproxy.proxy.layers.http._http1 import Http1Client


class ReleaseHttp1CloseTests(unittest.TestCase):
    """验证 HTTP/1 响应关闭策略不会提前丢失发布资源正文。"""
    def client(self):
        """构造连接到发布资源来源的 HTTP/1 客户端状态机。"""
        context = Context(connection.Client(peername=('192.0.2.1', 10001),
                                            sockname=('192.0.2.2', 10002)), options.Options())
        context.server.address = ('release.invalid', 18080)
        context.server.state = connection.ConnectionState.OPEN
        client = Http1Client(context)
        list(client.handle_event(events.Start()))
        request = http.Request.make('GET', 'http://release.invalid:18080/asset.js')
        list(client.handle_event(RequestHeaders(1, request, True)))
        list(client.handle_event(RequestEndOfMessage(1)))
        return client, context.server

    def test_完整正文后即关闭不等FIN且keepalive对照仍可复用(self):
        """验证完整正文后即关闭不等FIN且keepalive对照仍可复用。"""
        for header in (b'close', b'keep-alive'):
            self.check_complete_response(header)

    def test_提前断开不能因ConnectionClose而当作完整正文(self):
        """验证提前断开不能因ConnectionClose而当作完整正文。"""
        client, server = self.client()
        list(client.handle_event(events.DataReceived(server,
            b'HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabc')))
        result = list(client.handle_event(events.ConnectionClosed(server)))
        received = event_objects(result, ReceiveHttp)
        self.assertTrue(bool(instances(received, ResponseProtocolError)))
        self.assertFalse(bool(instances(received, ResponseEndOfMessage)))

    def check_complete_response(self, header):
        """验证完整正文与关闭命令，覆盖 keep-alive 对照。"""
        with self.subTest(connection=header):
            client, server = self.client()
            first = list(client.handle_event(events.DataReceived(server,
                b'HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: ' + header + b'\r\n\r\nabc')))
            self.assertFalse(bool(instances(first, commands.CloseConnection)))
            last = list(client.handle_event(events.DataReceived(server, b'def')))
            received = event_objects(first + last, ReceiveHttp)
            self.assertEqual(b''.join(event.data for event in instances(received, ResponseData)), b'abcdef')
            self.assertEqual(len(instances(received, ResponseEndOfMessage)), 1)
            closed = instances(last, commands.CloseConnection)
            self.assertEqual(len(closed), 1 if header == b'close' else 0)
            self.assert_closed_connection(closed, server)

    def assert_closed_connection(self, closed, server):
        """关闭命令必须指向实际上游连接。"""
        if closed:
            self.assertIs(closed[0].connection, server)
