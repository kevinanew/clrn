"""验证固定流水的收支、币种隔离、账号归属及默认透传，不访问真实服务。"""

from decimal import Decimal
import json
import unittest
from proxy_test_support import field_values
from unittest.mock import patch
from test_network_faults import flow, source_environment

with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
    from scenario_fixtures import ScenarioFixtures

SELF = '33333333-3333-4333-8333-333333333333'
OTHER = '22222222-2222-4222-8222-222222222222'


class WalletStatementTests(unittest.IsolatedAsyncioTestCase):
    """验证金币与钻石流水夹具的账号绑定、顺序及余额连续性。"""
    def setUp(self):
        """为每个用例配置隔离来源环境、控制令牌和独立代理状态。"""
        self.enterContext(source_environment())
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            self.addon = ScenarioFixtures()

    async def control(self, body):
        """选择当前账号的钱包流水场景。"""
        request = flow('http://fixtures-mitmproxy.invalid/fixtures/select', 'POST',
                       json.dumps(body).encode(), 'test-token')
        await self.addon.request(request)
        self.assertEqual(request.response.status_code, 200, '场景控制命令必须成功')

    async def request(self, path, method='GET', origin='https://node-0.service.invalid'):
        """将指定钱包读取交给场景插件并返回处理结果。"""
        request = flow(origin + path, method)
        await self.addon.request(request)
        return request

    async def test_非空流水必须显式选择并绑定账号且只拦截确切只读接口(self):
        """验证非空流水必须显式选择并绑定账号且只拦截确切只读接口。"""
        path = f'/v11/wallet/{SELF}/currency/coin/statement'
        self.assertIsNone((await self.request(path)).response, '默认场景必须透传')
        await self.control({'name': 'wallet-populated'})
        self.assertIsNone((await self.request(path)).response, '未绑定账号不能伪造流水')
        await self.control({'name': 'wallet-populated', 'userId': SELF})
        for other_path in (path.replace(SELF, OTHER), path.replace('coin', 'chip'),
                           path + '/extra', f'/v10/wallet/{SELF}', '/node/v1/status'):
            self.assertIsNone((await self.request(other_path)).response, '其他接口与账号必须透传')
        for method in ('POST', 'PUT', 'DELETE', 'OPTIONS'):
            self.assertIsNone((await self.request(path, method)).response, '写入和预检必须透传')
        self.assertIsNone((await self.request(path, origin='https://other.invalid')).response,
                          '未配置的接口主机必须透传')
        await self.control({'name': 'none'})
        self.assertIsNone((await self.request(path)).response, '退出场景后必须恢复透传')

    async def test_两种币种各含四条逆序收支且余额连续并能独立切回空态(self):
        """验证两种币种各含四条逆序收支且余额连续并能独立切回空态。"""
        await self.control({'name': 'wallet-populated', 'userId': SELF})
        identifiers = set()
        for currency in ('coin', 'diamond'):
            await self.check_currency_records(currency, identifiers)
        self.assertEqual(self.addon.status()['observed'], ['wallet:coin', 'wallet:diamond'],
                         '代理只记录币种命中，不记录真实用户标识')
        await self.control({'name': 'wallet-empty'})
        for currency in ('coin', 'diamond'):
            path = f'/v11/wallet/{SELF}/currency/{currency}/statement'
            self.assertEqual((await self.request(path)).response.json()['result'],
                             {'currency_name': currency, 'statements': []}, '空态不能遗留非空记录')

    async def check_currency_records(self, currency, identifiers):
        """验证币种、四条逆序收支以及跨币种唯一标识。"""
        path = f'/v11/wallet/{SELF}/currency/{currency}/statement'
        result = (await self.request(path)).response.json()['result']
        self.assertEqual(result['currency_name'], currency, '外层币种必须匹配请求')
        records = result['statements']
        self.assertEqual(len(records), 4, '每种币种必须提供四条展示记录')
        self.assertEqual({record['event'] for record in records}, {'deposit', 'withdraw'},
                         '必须同时覆盖收入与支出')
        self.assertEqual(field_values(records, 'create_at'),
                         sorted(field_values(records, 'create_at'), reverse=True),
                         '流水必须按时间逆序展示')
        balance = Decimal(0)
        for record in reversed(records):
            balance = self.check_record_balance(record, currency, identifiers, balance)

    def check_record_balance(self, record, currency, identifiers, balance):
        """验证单笔数量、收支方向及连续余额。"""
        self.assertEqual(record['currency_name'], currency, '条目不能串币种')
        self.assertNotIn(record['statement_id'], identifiers, '流水标识必须跨币种唯一')
        identifiers.add(record['statement_id'])
        self.assertTrue(record['memo'], '每条流水必须有可读备注')
        amount = Decimal(record['amount'])
        self.assertGreater(amount, 0, '交易数量必须为正数，由事件决定收支方向')
        balance += amount if record['event'] == 'deposit' else -amount
        self.assertEqual(Decimal(record['balance']), balance, '每笔交易后的余额必须连续')
        return balance
