"""仅监听回环地址的钱包边界：真实 HTTP 故障、余额及按交易编号去重的测试账本。"""

import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class IsolatedWallet:
    """每例使用独立端口和账本，绝不转发至共享 staging 钱包。"""

    def __init__(self):
        self.mode = "normal"
        self.balances = {}
        self.transactions = {}
        self.hits = []
        self.lock = threading.Lock()
        wallet = self

        class Handler(BaseHTTPRequestHandler):
            """只接受 SDK 当前使用的提现路径，不记录请求头或自由文本。"""

            def log_message(self, *_arguments):
                """禁用包含原始 HTTP 请求的默认访问日志。"""

            def do_POST(self):
                """执行本例钱包操作并返回真实 HTTP 状态或断开连接。"""
                parts = self.path.split("/")
                if (
                    len(parts) != 6
                    or parts[1:4] != ["service", "v11", "wallet"]
                    or parts[-1] != "withdraw"
                ):
                    self.send_error(404)
                    return
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                with wallet.lock:
                    mode = wallet.mode
                    wallet.hits.append(
                        {
                            "mode": mode,
                            "transaction": body["transaction_id"],
                            "player": parts[4],
                            "amount": int(body["amount"]),
                            "at": time.time(),
                        }
                    )
                if mode == "timeout":
                    time.sleep(2.3)
                    return
                if mode == "disconnect":
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                status, payload = wallet.reply(parts[4], body, mode)
                with wallet.lock:
                    wallet.hits[-1].update(
                        status=status,
                        errorType=payload.get("error_type")
                        if isinstance(payload, dict)
                        else None,
                    )
                if mode == "committed-response-lost":
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(
                    payload.encode()
                    if isinstance(payload, str)
                    else json.dumps(payload).encode()
                )

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def reply(self, player, body, mode):
        """业务错误保留实际类别；余额不足仅由账本余额判断产生。"""
        if mode in ("http-503", "http-504"):
            return int(mode[-3:]), {"upstream": "unavailable"}
        if mode == "invalid-json":
            return 200, "not-json"
        if mode == "missing-fields":
            return 200, {"ok": False}
        if mode == "conflict":
            return 200, {
                "ok": False,
                "error_type": "transaction_conflict",
                "error_message": "Transaction conflict",
            }
        with self.lock:
            transaction = body["transaction_id"]
            if transaction in self.transactions:
                return 200, {"ok": True, "result": {"statement_id": transaction}}
            amount = int(body["amount"])
            balance = self.balances.get(player, 10000)
            if balance < amount:
                return 200, {
                    "ok": False,
                    "error_type": "insufficient_balance",
                    "error_message": "Insufficient balance",
                }
            self.balances[player] = balance - amount
            self.transactions[transaction] = {"player": player, "amount": amount}
        return 200, {"ok": True, "result": {"statement_id": transaction}}

    def __enter__(self):
        """启动本例的钱包 HTTP 服务。"""
        self.thread.start()
        return self

    def __exit__(self, *_arguments):
        """停止服务并回收监听端口；延迟处理线程不阻止进程退出。"""
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
