"""以固定原版网关处理真实 RPC 请求，只将其下游 API 替换为本机 HTTP 5xx。"""

import hashlib
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request

GATEWAY_COMMIT = "e9be071eff77e1c767e63e36288935830b6dc6d3"


def serve():
    """加载未修改的网关 Blueprint；原始请求、HTTP 状态解析和两版封装均由它执行。"""
    from flask import Flask, jsonify, request
    from werkzeug.serving import make_server
    from apps.gateway.views import blueprint

    app = Flask("clrn-5xx-gateway")
    app.config["DEBUG"] = False
    app.register_blueprint(blueprint)
    faults = {}
    control = os.environ["CLRN_5XX_GATEWAY_TOKEN"]

    @app.after_request
    def observe(response):
        """从真正发出的 HTTP 响应记录状态，不以控制参数冒充观测结果。"""
        if request.path in faults:
            faults[request.path]["observedStatus"] = response.status_code
        return response

    @app.route("/v10/texas_holdem/room/<room>/sit", methods=["PUT"])
    def upstream(room):
        """唯一被模拟的应用 API：对本轮确切路径始终返回已指定的 5xx。"""
        fault = faults[request.path]
        if fault["format"] == "html":
            return "<h1>服务内部异常</h1>", fault["status"], {"Content-Type": "text/html"}
        return jsonify(ok=False, error_type="server_error", error_message="服务内部异常"), fault["status"]

    @app.route("/_clrn/invoke", methods=["POST"])
    def invoke():
        """认证本机控制并调用原始网关 HTTP 入口，不手工拼造应用收到的错误信封。"""
        if not secrets.compare_digest(request.headers.get("X-CLRN-Control", ""), control):
            return "Forbidden", 403
        body = request.get_json()
        status = body["status"]
        if type(status) is not int or not 500 <= status < 600:
            return "Only 5xx", 400
        payload = body["request"]
        path = payload["path"]
        if payload["method"] != "PUT" or not path.startswith("/v10/texas_holdem/room/") or not path.endswith("/sit"):
            return "Only sit", 400
        if body["format"] not in ("json", "html"):
            return "Invalid format", 400
        faults[path] = {"status": status, "format": body["format"]}
        envelope = {"client": "clrn-owned-socket", "transport": "websocket", "protocol": "json",
                    "encoding": "json", "user": body["userId"], "data": payload}
        forwarded = urllib.request.Request(app.config["GATEWAY_ROUTER_HOST"] + "/v1/centrifugo_gateway/",
                                           data=json.dumps(envelope).encode(),
                                           headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(forwarded, timeout=10) as response:
            gateway_reply = json.load(response)
        return jsonify(gatewayReply=gateway_reply, upstreamStatus=faults[path]["observedStatus"],
                       gatewayCommit=GATEWAY_COMMIT)

    server = make_server("127.0.0.1", 0, app, threaded=True)
    app.config["GATEWAY_ROUTER_HOST"] = f"http://127.0.0.1:{server.server_port}"
    Path(os.environ["CLRN_5XX_GATEWAY_READY"]).write_text(json.dumps({"url": app.config["GATEWAY_ROUTER_HOST"]}))
    server.serve_forever()


def provenance(source):
    """拒绝修订不符及源码修改，确保用原版网关而非测试重写的封装。"""
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
    if revision != GATEWAY_COMMIT:
        raise RuntimeError("网关源码不是指定的原版提交")
    if subprocess.check_output(["git", "diff", "HEAD", "--", "src"], cwd=source):
        raise RuntimeError("网关源码存在本地修改")
    files = ["apps/gateway/views.py", "apps/gateway/utils.py", "apps/gateway/serializers.py"]
    return {"repository": "kevinanew/centrifugo_gateway_flask", "commit": revision,
            "sourceSha256": {name: hashlib.sha256((source / "src" / name).read_bytes()).hexdigest() for name in files}}


def wait_ready(ready, child):
    """只有子进程存活且写出本轮地址后才启动浏览器。"""
    deadline = time.monotonic() + 20
    while not ready.exists():
        if child.poll() is not None or time.monotonic() >= deadline:
            raise RuntimeError("原版网关启动失败，未执行任何业务复现")
        time.sleep(0.05)
    return json.loads(ready.read_text())["url"]


def stop(child):
    """只回收本轮已知进程，拒绝按全局名称杀服务。"""
    if child.poll() is None:
        child.terminate()
    try:
        child.wait(timeout=10)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=5)


def run():
    """持有私有网关及日志目录，浏览器退出后无论成败都清理。"""
    source = Path(os.environ.get("CLRN_GATEWAY_SOURCE_ROOT", str(Path.home() / "github/kevinanew/centrifugo_gateway_flask")))
    evidence = provenance(source)
    output = Path("e2e/test-results/api-5xx") / os.environ["CLRN_5XX_RUN_ID"]
    (output / "gateway.json").write_text(json.dumps(evidence, indent=2))
    with tempfile.TemporaryDirectory(prefix="clrn-5xx-gateway-") as temporary:
        ready = Path(temporary) / "ready.json"
        token = secrets.token_hex(32)
        service_environment = {"PATH": os.environ["PATH"], "PYTHONPATH": str(source / "src"),
                               "NO_PROXY": "127.0.0.1,localhost", "CLRN_5XX_GATEWAY_TOKEN": token,
                               "CLRN_5XX_GATEWAY_READY": str(ready)}
        with (Path(temporary) / "service.log").open("wb") as log:
            gateway = subprocess.Popen([str(source / ".venv/bin/python"), __file__, "serve"],
                                       env=service_environment, stdout=log, stderr=log)
            browser = None
            try:
                url = wait_ready(ready, gateway)
                environment = {**os.environ, "CLRN_5XX_GATEWAY_URL": url, "CLRN_5XX_GATEWAY_TOKEN": token}
                browser = subprocess.Popen(sys.argv[2:], env=environment)
                return browser.wait()
            finally:
                if browser is not None:
                    stop(browser)
                stop(gateway)
                provenance(source)


def interrupt(_signal, _frame):
    """取消也进入 finally，删除私有日志和控制信息。"""
    raise KeyboardInterrupt


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupt)
    try:
        if sys.argv[1:] == ["serve"]:
            serve()
        else:
            sys.exit(run())
    except KeyboardInterrupt:
        sys.exit(130)
