"""运行未修改德州引擎与真实钱包 SDK；只隔离 Redis、消息出口和钱包 HTTP 地址。"""

import inspect
import json
import logging
import os
import random
import resource
import subprocess
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from isolated_wallet import IsolatedWallet
from poker_engine.controller.classic_controller import ClassicController
from poker_engine.view.dummy_queue_message import DummyQueueMessage
from poker_engine_v1.model.texas_holdem_room_db_v1 import TexasHoldemRoomDBV1
from poker_engine_v1.unittests.wrapper import PokerBaseTestV1
from poker_engine_v1.wrapper.all_in_wrapper_v1 import AllInWrapperV1
from poker_engine_v1.wrapper.apply_buy_in_wrapper_v1 import ApplyBuyInWrapperV1
from sdk.sdk_client import SDKConfig, SDKException
from sdk.user_transaction_flask import UserTransactionService

ROOM = uuid.UUID("94000000-0000-4000-8000-000000000001")
PLAYERS = [uuid.UUID(f"94000000-0000-4000-8000-{index:012}") for index in (2, 3)]


class BackendContract(unittest.TestCase):
    """正确行为断言；未修复的吞错及资金不一致使定向命令实际失败。"""

    def run_case(self, mode):
        """通过真实带入、准备和双方 all-in 触发自动补码，保留命中和账本。"""
        started = time.monotonic()
        with (
            IsolatedWallet() as wallet,
            patch("poker_engine.model.deck.system_random", random.Random(94)),
        ):

            class LocalTransactions(UserTransactionService):
                """只替换钱包地址；保留 SDK 的超时、重试和错误解析。"""

                def _get_config(self):
                    """采用生产 SDK 的两秒读取超时，绝不连接远端钱包。"""
                    return SDKConfig(f"http://127.0.0.1:{wallet.server.server_port}", 2)

            engine = PokerBaseTestV1()
            engine.setup_method()
            engine.new_room_wrapper_v1(
                ROOM, minimum_buy_in=155, currency="coin", audit_buy_in=False
            )
            for index, player in enumerate(PLAYERS, 1):
                engine.enter_room_controller(ROOM, player)
                self.invoke(
                    engine,
                    ApplyBuyInWrapperV1,
                    LocalTransactions,
                    player,
                    room_id=ROOM,
                    amount=155,
                    seat_number=index,
                )
                engine.enable_auto_rebuy_wrapper_v2(ROOM, player)
            engine.start_room_wrapper_v1(ROOM)
            for player in PLAYERS:
                engine.ready_wrapper_v1(ROOM, player)
            initial_transactions = len(wallet.transactions)
            wallet.mode = mode
            if mode == "insufficient":
                wallet.balances = {str(player): 0 for player in PLAYERS}
            before = dict(wallet.balances)
            first_hit = len(wallet.hits)
            error = None
            try:
                for _ in range(2):
                    controller = ClassicController(engine.config)
                    player = controller.table.get_current_player()
                    self.invoke(
                        engine,
                        AllInWrapperV1,
                        LocalTransactions,
                        player.player_id,
                        game_id=controller.game.game_id,
                        user_id=player.player_id,
                    )
            except Exception as caught:
                error = caught
            messages = engine.wrapper.player_message_all
            observation = {
                "mode": mode,
                "walletBefore": before,
                "walletAfter": dict(wallet.balances),
                "initialTransactions": initial_transactions,
                "transactions": len(wallet.transactions),
                "hits": wallet.hits[first_hit:],
                "events": [message["event"] for message in messages],
                "capturedAtMessageExit": [
                    message["event"] for message in engine.last_queue.delay_messages
                ],
                "messageDelivery": "isolated capture; not delivered by a real gateway",
                "errorClass": type(error).__name__ if error else None,
                "errorType": error.error_type
                if isinstance(error, SDKException)
                else None,
                "elapsedSeconds": round(time.monotonic() - started, 3),
            }
            observation["tableStacks"] = {
                str(player): ClassicController(engine.config)
                .player_pool.get_or_create(player)
                .stack
                for player in PLAYERS
            }
            if mode == "conflict":
                observation["recovery"] = self.recover(
                    engine, wallet, LocalTransactions, first_hit
                )
            self.save_observation(observation)
            self.assertEqual(initial_transactions, 2, "正常手动带入应实际扣款两次")
            self.assertTrue(observation["hits"], "必须由真实 all-in 触发钱包补码请求")
            self.verify(mode, observation, error, messages)

    def recover(self, engine, wallet, transactions, first_hit):
        """解除业务故障后执行真实手动带入，检查唯一扣款、筹码及入座。"""
        player = uuid.UUID(wallet.hits[first_hit]["player"])
        balance = wallet.balances[str(player)]
        count = len(wallet.transactions)
        wallet.mode = "normal"
        self.invoke(
            engine,
            ApplyBuyInWrapperV1,
            transactions,
            player,
            room_id=ROOM,
            amount=155,
            seat_number=PLAYERS.index(player) + 1,
        )
        controller = ClassicController(engine.config)
        result = {
            "walletBefore": balance,
            "walletAfter": wallet.balances[str(player)],
            "stack": controller.player_pool.get_or_create(player).stack,
            "newTransactions": len(wallet.transactions) - count,
            "seated": controller.table.has_seated_player(
                controller.player_pool.get_or_create(player)
            ),
        }
        self.assertEqual(
            result,
            {
                "walletBefore": 9845,
                "walletAfter": 9690,
                "stack": 155,
                "newTransactions": 1,
                "seated": True,
            },
        )
        return result

    def invoke(self, engine, wrapper_type, transactions, player, **arguments):
        """执行真实包装器并读取它持久化的房间配置，不伪造离座或补码事件。"""
        wrapper = wrapper_type()
        engine.last_queue = DummyQueueMessage(ROOM)
        wrapper.set_queue_message(engine.last_queue)
        wrapper.set_redis_client(engine.fake_redis_client)
        wrapper.set_room_db(TexasHoldemRoomDBV1, ROOM)
        wrapper.set_user_transaction_service_class(transactions)
        wrapper.set_user_id(player)
        wrapper.set_accept_language("zh")
        wrapper.set_api_args(**arguments)
        engine.wrapper = wrapper
        try:
            wrapper.run()
        finally:
            engine.config = engine._get_room_config(ROOM)

    def save_observation(self, observation):
        """只保存本机虚构标识、错误类别、实际金额及事件名。"""
        directory = Path(
            os.environ.get(
                "ISSUE94_BACKEND_REPORT", "e2e/test-results/issue-94/backend"
            )
        )
        directory.mkdir(parents=True, exist_ok=True)
        (directory / f"{observation['mode']}.json").write_text(
            json.dumps(observation, indent=2) + "\n"
        )

    def verify(self, mode, observation, error, messages):
        """分别断言真实不足、其他业务错误和传输错误，不要求所有故障都留座。"""
        if mode == "normal":
            self.assertIsNone(error)
            self.assertIn("deposit_buy_in", observation["events"])
            self.assertEqual(observation["transactions"], 3)
        elif mode == "conflict":
            self.assertEqual(observation["walletBefore"], observation["walletAfter"])
            reported = (
                isinstance(error, SDKException)
                and error.error_type == "transaction_conflict"
            )
            reported = reported or any(
                message.get("error_type") == "transaction_conflict"
                for message in messages
            )
            self.assertTrue(
                reported, "钱包充足时 transaction_conflict 不得被自动补码静默吞掉"
            )
        elif mode == "insufficient":
            self.assertEqual(observation["transactions"], 2)
            self.assertIn("stand_up", observation["events"])
        elif mode == "committed-response-lost":
            self.assertEqual(
                len({hit["transaction"] for hit in observation["hits"]}), 1
            )
            self.assertEqual(
                observation["transactions"], 3, "丢回复后的 SDK 重试只能扣款一次"
            )
            self.assertIsNotNone(error, "丢失全部回复应如实结束为传输失败")
        else:
            self.assertIsNotNone(error)
            self.assertNotIsInstance(
                error, SDKException, "实际 HTTP 和超时不能伪装成钱包业务错误"
            )
            self.assertEqual(
                len(observation["hits"]), 1 if mode == "missing-fields" else 3
            )
            self.assertEqual(observation["walletBefore"], observation["walletAfter"])
            if mode == "timeout":
                self.assertGreaterEqual(observation["elapsedSeconds"], 6)

    def test_normal(self):
        """正常手动带入及筹码耗尽后的自动补码应完成真实钱包交易。"""
        self.run_case("normal")

    def test_business_conflict_preserves_reason(self):
        """有足够金币时，非余额业务错误必须向调用者或玩家保留原因。"""
        self.run_case("conflict")

    def test_insufficient(self):
        """真实账本不足时不扣款、不补码，并保留离座行为。"""
        self.run_case("insufficient")

    def test_http_503(self):
        """真实 HTTP 503 经真实 SDK 重试后仍为传输异常。"""
        self.run_case("http-503")

    def test_http_504(self):
        """真实 HTTP 504 经真实 SDK 重试后仍为传输异常。"""
        self.run_case("http-504")

    def test_disconnect(self):
        """真实连接断开不产生钱包交易。"""
        self.run_case("disconnect")

    def test_read_timeout(self):
        """真实等待超过两秒，重试三次并保留失败。"""
        self.run_case("timeout")

    def test_committed_response_lost(self):
        """请求提交后丢回复仍须核对实际账本，不能假定没有扣款。"""
        self.run_case("committed-response-lost")

    def test_invalid_json(self):
        """真实 HTTP 非 JSON 回复经 SDK 解析和重试后保留异常。"""
        self.run_case("invalid-json")

    def test_missing_fields(self):
        """缺失业务错误字段的真实 JSON 回复不能被误判为余额不足。"""
        self.run_case("missing-fields")


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    source = Path(inspect.getfile(ClassicController)).resolve().parents[3]
    source_commit = subprocess.check_output(
        ["git", "-C", str(source), "rev-parse", "HEAD"], text=True
    ).strip()
    expected_commit = os.environ.get(
        "ISSUE94_TEXAS_COMMIT", "def3a1291c4ef0add64b46cc302d2ea730425675"
    )
    if source_commit != expected_commit:
        raise RuntimeError("德州源码提交与指定版本不符，拒绝混用环境")
    subprocess.run(
        ["git", "-C", str(source), "diff", "--exit-code", "--quiet"], check=True
    )
    print(
        json.dumps(
            {
                "texasSourceCommit": source_commit,
                "environment": "isolated-engine-http-wallet; not deployed staging",
            }
        )
    )
    started_at = time.monotonic()
    try:
        unittest.main(verbosity=2)
    finally:
        print(
            json.dumps(
                {
                    "elapsedSeconds": round(time.monotonic() - started_at, 3),
                    "maximumResidentSetSize": resource.getrusage(
                        resource.RUSAGE_SELF
                    ).ru_maxrss,
                    "memoryUnit": "bytes on macOS; KiB on Linux",
                }
            )
        )
