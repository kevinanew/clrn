/** 校验本次流水响应及当前币种列表，拒绝空容器、错币种和不完整的截图内容。 */
import { expect, type Page, type Response } from '@playwright/test';
import type { LocaleCode } from '../../scenarioTypes';
import { readRequestJson } from '../../src/support/requestJson';

export type TransactionCurrency = 'coin' | 'diamond';
/** 视觉夹具的流水契约独立于功能测试，避免类型导入引入另一套 Playwright 依赖。 */
export type TransactionStatement = {
  currency_name: TransactionCurrency;
  amount: string;
  balance: string;
  event: 'deposit' | 'withdraw';
  create_at: string;
  memo: string;
  statement_id: string;
};
const expectedAmounts = { coin: ['-300', '+800', '-1200', '+20000'], diamond: ['-5', '+10', '-10', '+100'] };
const balanceLabels = { 'zh-Hans': '余额', 'zh-Hant': '餘額', en: 'Balance' };
// 这些文案精确匹配应用翻译资源，作为界面预期值，不参与生成网络响应。
const memoLabels = {
  'zh-Hans': { coin: ['申请买入金币', '房间退款', '入座买入金币', '注册奖励'],
    diamond: ['更新俱乐部简介扣款', '操作失败退款', '创建俱乐部扣款', '注册奖励'] },
  'zh-Hant': { coin: ['申請買入金幣', '房間退款', '入座買入金幣', '註冊獎勵'],
    diamond: ['更新俱樂部簡介扣款', '操作失敗退款', '創建俱樂部扣款', '註冊獎勵'] },
  en: { coin: ['Apply buy in coin in room', 'Refund room', 'Enter sit buy in coin in room', 'Registration reward'],
    diamond: ['Update club intro deduction', 'Operation failed refund', 'Create club deduction', 'Registration reward'] },
};

/**
 * 在导航或切换前监听本账号的确切流水读取请求，其他账号和写操作不能替代。
 * @param page - 使用本轮代理的页面。
 * @param userId - 从真实登录缓存读取的本轮账号标识。
 * @param currency - 本次期望读取的币种。
 */
export function waitForTransactionResponse(page: Page, userId: string, currency: TransactionCurrency): Promise<Response> {
  return page.waitForResponse(
    /**
     * 只接受应用本次发出的指定账号与币种的只读请求。
     * @param response - 浏览器实际收到的响应。
     */
    response => response.request().method() === 'GET'
      && new URL(response.url()).pathname === `/v11/wallet/${userId}/currency/${currency}/statement`,
  );
}

/**
 * 确认代理返回完整且稳定的四条收支记录，再交给页面校验使用。
 * @param response - 本次导航实际收到的流水响应。
 * @param currency - 请求目标币种。
 */
export async function readTransactionFixture(response: Response, currency: TransactionCurrency): Promise<TransactionStatement[]> {
  // 视觉与功能套件独立安装依赖；编译和运行时均只使用视觉套件的类型及响应解析入口。
  const body = await readRequestJson(response, 'wallet-statements');
  expect(body.result, '流水响应必须包含所选币种与列表').toMatchObject({
    currency_name: currency, statements: expect.any(Array),
  });
  const statements: TransactionStatement[] = body.result.statements;
  expect(statements, '固定流水场景必须返回四条记录，不能把空响应当成就绪').toHaveLength(4);
  for (const statement of statements) {
    expect(statement, '固定流水的币种与必要字段必须完整').toMatchObject({
      currency_name: currency, amount: expect.stringMatching(/^\d+$/), balance: expect.stringMatching(/^\d+$/),
      event: expect.stringMatching(/^(deposit|withdraw)$/), create_at: expect.any(String),
      memo: expect.any(String), statement_id: expect.stringMatching(/\S/),
    });
    expect(Number.isFinite(Date.parse(statement.create_at)), '流水时间必须合法').toBe(true);
  }
  expect(statements.map(
    /**
     * 按接口事件生成预期收支符号。
     * @param statement - 已校验的单条流水。
     */
    statement => `${statement.event === 'deposit' ? '+' : '-'}${statement.amount}`,
  ), '流水必须属于所选固定场景，不能退回真实账号的不确定数据').toEqual(expectedAmounts[currency]);
  return statements;
}

/**
 * 逐条核对当前列表的收支、余额、固定时区日期和备注，其他列表中的条目不能混入。
 * @param page - 已完成应用初始化和导航的页面。
 * @param currency - 当前应显示的币种。
 * @param locale - 当前截图语言。
 * @param statements - 本次响应中已经通过校验的记录。
 */
export async function assertTransactionsReady(page: Page, currency: TransactionCurrency,
  locale: LocaleCode, statements: TransactionStatement[]): Promise<void> {
  const identifier = currency === 'coin' ? 'coin-transaction-record-view' : 'account-security-items-list';
  const list = page.getByTestId(identifier);
  await expect(list, '目标币种列表必须位于当前可见页面').toBeInViewport();
  const rows = list.getByTestId('CurrencyTransactionRecordItem_container');
  await expect(rows, '列表必须显示本次响应中的全部四条流水').toHaveCount(statements.length);
  for (const [index, statement] of statements.entries()) {
    const row = rows.nth(index);
    await expect(row, '每条固定流水都必须完整位于截图视口内').toBeInViewport({ ratio: 1 });
    await expect(row.getByTestId('CurrencyTransactionRecordItem_amount'), '收支符号与金额必须匹配本次响应')
      .toHaveText(`${statement.event === 'deposit' ? '+' : '-'}${statement.amount}`);
    await expect(row.getByTestId('CurrencyTransactionRecordItem_balance'), '余额必须匹配本次响应和当前语言')
      .toHaveText(`${balanceLabels[locale]}: ${statement.balance}`);
    const date = new Date(Date.parse(statement.create_at) + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    await expect(row.getByTestId('CurrencyTransactionRecordItem_date'), '流水日期必须按固定的上海时区展示')
      .toHaveText(date);
    await expect(row.getByTestId('CurrencyTransactionRecordItem_memo'), '交易备注必须匹配当前币种和语言')
      .toHaveText(memoLabels[locale][currency][index]);
    const identifier = statement.memo?.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0];
    await expect(row.getByTestId('CurrencyTransactionRecordItem_uuidText'), '房间标识必须单独展示，不能遗漏或混入其他流水')
      .toHaveText(identifier ? [identifier] : []);
  }
}
