"""公共日志采集器离线自测的 HTTP 源；只监听回环，不使用账号或业务接口。"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PAGE = b'''<input type="password" data-testid="password">
<button data-testid="action" onclick="console.log('application-handled')">action</button>
<script>for(const level of ['debug','info','log','warn','error']) console[level]('startup-'+level);
console.log('Authorization: Bearer public-browser-sentinel');
console.log('payload={"nested":"public-body-sentinel"}');
fetch('/503'); fetch('/drop').catch(()=>{});
window.dispatchEvent(new CustomEvent('laiwan:connection-diagnostic',{
detail:{event:'probe.cache',cacheAgeMs:42,token:'public-event-sentinel'}}));
setTimeout(()=>{throw new TypeError('controlled-page-error')}, 30);</script>'''


class DiagnosticHandler(BaseHTTPRequestHandler):
    """提供真实的受控状态/断连和输出页面，不修改浏览器网络 API。"""

    def do_GET(self):
        """处理本机请求并制造明确可观察的失败。"""
        if self.path == '/drop':
            self.close_connection = True
            return
        self.send_response(503 if self.path == '/503' else 200)
        self.send_header('Content-Type', 'text/html')
        self.send_header('Content-Length', str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)

    def log_message(self, _format, *_args):
        """自测源不输出连接资料；生产代理输出仍由原采集器验证。"""


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), DiagnosticHandler)
    print(server.server_port, flush=True)
    server.serve_forever()
