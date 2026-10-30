"""锁定代理的真实 HTTP/1 状态机对照，不依赖 FIN 到达顺序或外部网络。"""
import unittest
from mitmproxy import connection, http, options
from mitmproxy.proxy import commands, events
from mitmproxy.proxy.context import Context
from mitmproxy.proxy.layers.http._base import ReceiveHttp
from mitmproxy.proxy.layers.http._events import (
    RequestHeaders, RequestEndOfMessage, ResponseData, ResponseEndOfMessage, ResponseProtocolError,
)
from mitmproxy.proxy.layers.http._http1 import Http1Client


class ReleaseHttp1CloseTests(unittest.TestCase):
    def client(self):
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
        for header in (b'close', b'keep-alive'):
            with self.subTest(connection=header):
                client, server = self.client()
                first = list(client.handle_event(events.DataReceived(server,
                    b'HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: ' + header + b'\r\n\r\nabc')))
                self.assertFalse(any(isinstance(command, commands.CloseConnection) for command in first))
                last = list(client.handle_event(events.DataReceived(server, b'def')))
                received = [command.event for command in first + last if isinstance(command, ReceiveHttp)]
                self.assertEqual(b''.join(event.data for event in received if isinstance(event, ResponseData)), b'abcdef')
                self.assertEqual(sum(isinstance(event, ResponseEndOfMessage) for event in received), 1)
                closed = [command for command in last if isinstance(command, commands.CloseConnection)]
                self.assertEqual(len(closed), 1 if header == b'close' else 0)
                if closed:
                    self.assertIs(closed[0].connection, server)

    def test_提前断开不能因ConnectionClose而当作完整正文(self):
        client, server = self.client()
        list(client.handle_event(events.DataReceived(server,
            b'HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabc')))
        result = list(client.handle_event(events.ConnectionClosed(server)))
        received = [command.event for command in result if isinstance(command, ReceiveHttp)]
        self.assertTrue(any(isinstance(event, ResponseProtocolError) for event in received))
        self.assertFalse(any(isinstance(event, ResponseEndOfMessage) for event in received))
