/** 使用真实浏览器校验流水截图门禁，拒绝空容器、错误数据及其他页签的残留条目。 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page, type Response } from '@playwright/test';
import type { Statement } from '../../e2e/cases/settings-012-wallet-currencies/statements';
import { assertTransactionsReady, readTransactionFixture } from '../cases/wallet/transactionReadiness';
import { lockPageWidth } from '../src/support/pageStabilizers';

const records: { coin: Statement[]; diamond: Statement[] } = JSON.parse(readFileSync(
  path.resolve(__dirname, '../../e2e/mitmproxy/data/wallet-statements.json'), 'utf8',
));
const remarks = ['申请买入金币', '房间退款', '入座买入金币', '注册奖励'];

/**
 * 按应用的流水定位契约构造浏览器页面，只测试截图门禁，不作为应用截图基准。
 * @param page - 隔离的真实浏览器页面。
 * @param fault - 本例需要重现的错误类型。
 */
async function renderTransactions(page: Page, fault = ''): Promise<void> {
  const rows = records.coin.map(
    /**
     * 创建带真实金额、余额、日期和备注节点的单条流水。
     * @param record - Python 夹具中的固定流水。
     * @param index - 倒序流水的位置。
     */
    (record, index) => {
      const date = new Date(Date.parse(record.create_at) + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
      const identifier = record.memo?.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0];
      return `<div data-testid="CurrencyTransactionRecordItem_container" style="height:100px">
        <span data-testid="CurrencyTransactionRecordItem_amount">${fault === '金额错误' ? '-999' : `${record.event === 'deposit' ? '+' : '-'}${record.amount}`}</span>
        <span data-testid="CurrencyTransactionRecordItem_balance">余额: ${fault === '余额错误' ? '999' : record.balance}</span>
        <span data-testid="CurrencyTransactionRecordItem_date">${fault === '日期错误' ? '2000-01-01 00:00:00' : date}</span>
        <span data-testid="CurrencyTransactionRecordItem_memo">${fault === '备注错误' ? '错误备注' : remarks[index]}</span>
        ${identifier ? `<span data-testid="CurrencyTransactionRecordItem_uuidText">${identifier}</span>` : ''}
      </div>`;
    },
  ).join('');
  await page.setContent(`<div data-testid="other-list">${fault === '其他列表有数据' ? rows : ''}</div>
    <div data-testid="coin-transaction-record-view" style="height:600px;${fault === '离屏列表' ? 'position:absolute;left:2000px' : ''}">
      ${['空容器', '其他列表有数据'].includes(fault) ? '' : rows}
    </div>`);
}

test.use({ viewport: { width: 375, height: 812 } });
test('页面限宽保留钱包双页轨道，金币和钻石都能完整显示',
  /**
   * 重现应用分页布局，验证截图准备不会把第二页裁成空白。
   * @param fixtures - Playwright 提供的页面。
   */
  async ({ page }) => {
    await page.setContent(`<style>body{margin:0}</style>
      <div style="width:375px;overflow:hidden">
        <div data-testid="transaction-track" style="display:flex;width:750px">
          <div data-testid="coin-transaction-record-view" style="width:375px;height:600px;flex-shrink:0">金币流水</div>
          <div data-testid="account-security-items-list" style="width:375px;height:600px;flex-shrink:0">钻石流水</div>
        </div>
      </div>`);
    await lockPageWidth(page, 375);
    await expect(page.getByTestId('transaction-track'), '双页轨道必须保留两页总宽度').toHaveCSS('width', '750px');
    await expect(page.getByTestId('coin-transaction-record-view'), '初始金币页必须完整显示').toBeInViewport({ ratio: 1 });
    await page.getByTestId('transaction-track').evaluate(
      /**
       * 重现应用切换钻石时对整条轨道的平移。
       * @param element - 双页轨道。
       */
      element => { element.style.transform = 'translateX(-375px)'; },
    );
    await expect(page.getByTestId('account-security-items-list'), '钻石页不能被限宽规则裁空').toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('coin-transaction-record-view'), '非活动金币页不能冒充当前页').not.toBeInViewport();
  },
);

test('完整固定流水通过截图门禁',
  /**
   * 验证正确的四条流水在真实布局引擎中全部可见。
   * @param fixtures - Playwright 提供的页面。
   */
  async ({ page }) => {
    await renderTransactions(page);
    await assertTransactionsReady(page, 'coin', 'zh-Hans', records.coin);
  },
);

for (const fault of ['空容器', '其他列表有数据', '金额错误', '余额错误', '日期错误', '备注错误', '离屏列表']) {
  test(`流水截图门禁拒绝${fault}`,
    /**
     * 错误页面即使保留正确的列表外壳，也不能通过截图门禁。
     * @param fixtures - Playwright 提供的页面。
     */
    async ({ page }) => {
      test.setTimeout(15_000);
      await renderTransactions(page, fault);
      await expect(assertTransactionsReady(page, 'coin', 'zh-Hans', records.coin), '错误内容必须阻止截图')
        .rejects.toThrow();
    },
  );
}

for (const currency of ['coin', 'diamond'] as const) {
  test(`${currency} 固定响应校验拒绝空数据、业务失败及串币种`,
    /** 在响应边界测试失败输入，防止空数组再次变成截图通过条件。 */
    async () => {
      for (const body of [
        { ok: true, result: { currency_name: currency, statements: [] } },
        { ok: false, result: { currency_name: currency, statements: records[currency] } },
        { ok: true, result: { currency_name: currency, statements: records[currency === 'coin' ? 'diamond' : 'coin'] } },
      ]) {
        const response = {
          ok: /** 模拟 HTTP 成功，以单独验证业务和数据契约。 */ () => true,
          status: /** 保留真实响应解析器需要读取的状态码。 */ () => 200,
          json: /** 返回当前负例响应，不生成任何应用网络流量。 */ async () => body,
        } as Response;
        await expect(readTransactionFixture(response, currency), '无效响应必须阻止流水截图').rejects.toThrow();
      }
    },
  );
}
