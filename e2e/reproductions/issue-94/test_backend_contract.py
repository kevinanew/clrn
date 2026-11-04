"""验证复现断言本身：真实转换丢字段、未投递和错误接收者都不能被验收。"""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import backend_contract as contract


class BackendContractValidationTests(unittest.TestCase):
    """使用固定德州源码的真实引擎、协议转换器及 SDK，不连接共享服务。"""

    def setUp(self):
        self.validator = contract.BackendContract()
        self.player, self.other = map(str, contract.PLAYERS)
        self.observation = {
            "walletBefore": {self.player: 9845},
            "walletAfter": {self.player: 9845},
            "hits": [{"player": self.player, "errorType": "transaction_conflict"}],
            "messageExit": {"roomPublic": [], "playersPrivate": {}},
        }

    def run_conflict(self, delivery):
        """在消息边界制造坏修复，仍执行真实双方 all-in、再次入座和恢复。"""
        original_send = contract.DummyQueueMessage.send

        def send(queue, messages):
            """内部补原因不能代替出口；出口夹具仅用于检验验收器。"""
            for message in messages:
                if message["event"] == "prompt_buy_in":
                    message["error_type"] = "transaction_conflict"
            result = original_send(queue, messages)
            self.change_delivery(queue, delivery)
            return result

        with (
            tempfile.TemporaryDirectory() as directory,
            patch.dict(os.environ, {"ISSUE94_BACKEND_REPORT": directory}),
            patch.object(contract.DummyQueueMessage, "send", send),
        ):
            if delivery == "correct-player":
                self.validator.run_case("conflict")
            else:
                with self.assertRaisesRegex(AssertionError, "消息出口必须向钱包故障玩家"):
                    self.validator.run_case("conflict")
            return json.loads((Path(directory) / "conflict.json").read_text())

    def change_delivery(self, queue, delivery):
        """先固定候选消息，避免移动到其他玩家后在同次遍历中再次处理。"""
        prompts = [
            (player, message)
            for player, private in queue.send_players_private_messages.items()
            for message in private
            if message["event"] == "prompt_buy_in"
        ]
        for player, message in prompts:
            if delivery == "not-delivered":
                queue.send_players_private_messages[player].remove(message)
            elif delivery in ("wrong-player", "correct-player"):
                message["error_type"] = "transaction_conflict"
                if delivery == "wrong-player":
                    queue.send_players_private_messages[player].remove(message)
                    other = next(str(item) for item in contract.PLAYERS if str(item) != str(player))
                    queue.send_players_private_messages[other].append(message)

    def test_internal_reason_stripped_by_real_converter_is_rejected(self):
        """固定版本会丢弃内部 prompt_buy_in.error_type，验收必须实际失败。"""
        observation = self.run_conflict("stripped")
        player = observation["hits"][0]["player"]
        prompt = next(
            message
            for message in observation["messageExit"]["playersPrivate"][player]
            if message["event"] == "prompt_buy_in"
        )
        self.assertNotIn("error_type", prompt)
        self.assertTrue(observation["recovery"]["seated"])

    def test_generated_but_not_delivered_reason_is_rejected(self):
        """内部消息仍生成但未到达出口时，不能因后续入座和恢复而误通过。"""
        observation = self.run_conflict("not-delivered")
        self.assertIn("prompt_buy_in", observation["events"])
        self.assertFalse(
            any(
                message["event"] == "prompt_buy_in"
                for messages in observation["messageExit"]["playersPrivate"].values()
                for message in messages
            )
        )

    def test_reason_delivered_only_to_other_player_is_rejected(self):
        """出口存在冲突原因但只向另一玩家发送，真实驱动必须失败。"""
        observation = self.run_conflict("wrong-player")
        player = observation["hits"][0]["player"]
        recipients = {
            recipient
            for recipient, messages in observation["messageExit"]["playersPrivate"].items()
            if any(message.get("error_type") == "transaction_conflict" for message in messages)
        }
        self.assertTrue(recipients)
        self.assertNotIn(player, recipients)

    def test_correct_private_delivery_survives_resit_and_recovery(self):
        """正确接收者的出口夹具可通过，原始快照不会被重新入座的队列替换。"""
        observation = self.run_conflict("correct-player")
        self.assertIn("stand_up", observation["capturedAtMessageExit"])
        self.assertEqual(
            observation["resitWithoutBuyIn"]["capturedAtMessageExit"], ["prompt_buy_in"]
        )
        self.assertEqual(observation["recovery"]["newTransactions"], 1)

    def test_real_sdk_exception_preserves_legal_caller_branch(self):
        """真实 HTTP 业务回复经 SDK 解析后抛出的异常可满足调用者分支。"""
        with contract.IsolatedWallet() as wallet:
            wallet.mode = "conflict"
            wallet.balances[self.player] = 9845

            class LocalTransactions(contract.UserTransactionService):
                """只重定向钱包地址，保留真实 HTTP 与 SDK 异常解析。"""

                def _get_config(self):
                    """钱包服务只监听本例的随机回环端口。"""
                    return contract.SDKConfig(f"http://127.0.0.1:{wallet.server.server_port}", 2)

            self.observation["walletBefore"] = dict(wallet.balances)
            with self.assertRaises(contract.SDKException) as caught:
                LocalTransactions().withdraw(
                    wallet_id=self.player, transaction_id=str(contract.ROOM),
                    currency_name="coin", amount=155, accept_language="zh",
                )
            self.observation["walletAfter"] = dict(wallet.balances)
            self.observation["hits"] = wallet.hits
            self.validator.verify("conflict", self.observation, caught.exception)

    def test_other_exceptions_cannot_substitute_for_conflict(self):
        """泛型异常或其他 SDK 业务原因不能满足交易冲突断言。"""
        for error in (Exception("transaction_conflict"), contract.SDKException("insufficient_balance")):
            with self.subTest(error=type(error).__name__):
                with self.assertRaises(AssertionError):
                    self.validator.verify("conflict", self.observation, error)

    def test_public_reason_must_identify_affected_player(self):
        """公共频道广播的错误也须明确属于本次钱包故障玩家。"""
        for player in (None, self.other, self.player):
            with self.subTest(player=player):
                self.observation["messageExit"]["roomPublic"] = [
                    {"event": "stand_up", "player_id": player,
                     "error_type": "transaction_conflict"}
                ]
                if player == self.player:
                    self.validator.verify("conflict", self.observation, None)
                else:
                    with self.assertRaises(AssertionError):
                        self.validator.verify("conflict", self.observation, None)

    def test_every_conflicted_player_requires_own_reason(self):
        """多个故障玩家不能由向单个玩家发送的原因一并满足。"""
        self.observation["hits"].append(
            {"player": self.other, "errorType": "transaction_conflict"}
        )
        self.observation["messageExit"]["playersPrivate"][self.player] = [
            {"event": "prompt_buy_in", "error_type": "transaction_conflict"}
        ]
        with self.assertRaises(AssertionError):
            self.validator.verify("conflict", self.observation, None)

    def test_capture_is_complete_detached_and_serializable(self):
        """保存完整消息、UUID 路由与嵌套字段，后续修改不能污染快照。"""
        queue = contract.DummyQueueMessage(contract.ROOM)
        queue.send_room_public_messages = [{"event": "stand_up", "player_id": contract.PLAYERS[0]}]
        queue.send_players_private_messages = {
            contract.PLAYERS[0]: [{"event": "prompt_buy_in", "buy_in": {"minimum": 155}}]
        }
        captured = contract.capture_message_exit(queue)
        queue.send_players_private_messages[contract.PLAYERS[0]][0]["buy_in"]["minimum"] = 0
        queue.send_room_public_messages.clear()
        serialized = json.loads(json.dumps(captured, default=contract.json_uuid))
        self.assertEqual(serialized, {
            "roomPublic": [{"event": "stand_up", "player_id": self.player}],
            "playersPrivate": {
                self.player: [{"event": "prompt_buy_in", "buy_in": {"minimum": 155}}]
            },
        })


if __name__ == "__main__":
    unittest.main(verbosity=2)
