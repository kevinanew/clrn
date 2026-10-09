import { expect, test, type Response } from '@playwright/test';
import { expectStatementList, readStatements, type Statement } from './cases/settings-012-wallet-currencies/statements';

const statement: Statement = {
  currency_name: 'coin', amount: '12.50', balance: '101.25', event: 'deposit',
  create_at: '2026-10-09T01:02:03Z', memo: 'Registration reward', statement_id: 'fixture-id',
};
/**
 * 构造可供流水解析测试使用的 HTTP 响应替身。
 * @param body - 测试替身返回的响应正文。
 * @param ok - 测试响应是否模拟 HTTP 成功状态。
 */
const response = (body: unknown, ok = true) => ({
  /** 返回测试响应的预设 HTTP 成功状态。 */
  ok: () => ok,
  /** 返回测试响应的预设 JSON 正文。 */
  json: async () => body }) as Response;

for (const currency of ['coin', 'diamond'] as const) {
  test(`流水响应校验：${currency} 接受有效和空数据，拒绝业务失败、错币种及无效结构`, async () => {
    const valid = { ...statement, currency_name: currency };
    const body = { ok: true, result: { currency_name: currency, statements: [valid] } };
    expect(await readStatements(response(body), currency)).toEqual([valid]);
    const nullableMemo = { ...valid, memo: null };
    expect(await readStatements(response({ ...body, result: { ...body.result, statements: [nullableMemo] } }), currency)).toEqual([nullableMemo]);
    const localized = { ...valid, currency_name: currency === 'coin' ? '金币' : '钻石' };
    expect(await readStatements(response({ ...body, result: { ...body.result, statements: [localized] } }), currency)).toEqual([localized]);
    expect(await readStatements(response({ ...body, result: { ...body.result, statements: [] } }), currency)).toEqual([]);
    const other = currency === 'coin' ? 'diamond' : 'coin';
    for (const invalid of [
      null, { ...body, ok: false }, { ...body, result: null },
      { ...body, result: { ...body.result, currency_name: other } },
      { ...body, result: { ...body.result, statements: {} } },
      ...[null, {}, { ...valid, currency_name: other },
        { ...valid, currency_name: currency === 'coin' ? '钻石' : '金币' }, { ...valid, amount: 'NaN' },
        { ...valid, balance: null }, { ...valid, event: 'unknown' },
        { ...valid, create_at: 'invalid' }, { ...valid, memo: 42 }, { ...valid, memo: undefined },
        { ...valid, statement_id: '' }].map(item => ({ ...body, result: { ...body.result, statements: [item] } })),
    ]) {
      await expect(readStatements(response(invalid), currency)).rejects.toThrow();
    }
    await expect(readStatements(response(body, false), currency)).rejects.toThrow();
    await expect(readStatements({
      /** 返回测试响应的预设 HTTP 成功状态。 */
      ok: () => true,
      /** 模拟 JSON 解析失败，验证流水校验能拒绝非法响应。 */
      json: async () => { throw new SyntaxError('invalid JSON'); } } as unknown as Response, currency))
      .rejects.toThrow('invalid JSON');
  });
}

/**
 * 生成带金额、余额和日期的流水行 HTML，用于验证页面列表断言。
 * @param amount - 页面显示的交易金额文本。
 * @param balance - 页面显示的交易后余额文本。
 * @param date - 页面显示的交易时间文本。
 */
const row = (amount = '+12.50', balance = '余额: 101.25', date = '2026-10-09 09:02:03') => `
  <div data-testid="CurrencyTransactionRecordItem_container">
    <div data-testid="CurrencyTransactionRecordItem_amount">${amount}</div>
    <div data-testid="CurrencyTransactionRecordItem_balance">${balance}</div>
    <div data-testid="CurrencyTransactionRecordItem_date">${date}</div>
  </div>`;

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test.describe(`流水展示校验：${viewport.width}px`, () => {
    test.use({ viewport, timezoneId: 'Asia/Shanghai' });

    test('正确收支、金额、余额、时区及空列表通过；其他列表的条目不混入', async ({ page }) => {
      await page.setContent(`<div data-testid="other-list">${row('-999')}</div><div data-testid="list">${row()}</div>`);
      const list = page.getByTestId('list');
      await expectStatementList(list, [statement]);
      await page.setContent(`<div data-testid="list">${row('-12.50')}</div>`);
      await expectStatementList(list, [{ ...statement, event: 'withdraw', currency_name: 'diamond' }]);
      await page.setContent(`<div data-testid="other-list">${row()}</div><div data-testid="list" style="height:100px"></div>`);
      await expectStatementList(list, []);
    });

    for (const [name, content] of [
      ['错误金额', row('-12.50')], ['错误余额', row('+12.50', '余额: 999')],
      ['错误时间', row('+12.50', '余额: 101.25', '2026-10-08 09:02:03')],
      ['预挂载空容器', ''],
    ]) {
      test(`${name}不能通过，即使其他列表有正确条目`, async ({ page }) => {
        await page.setContent(`<div data-testid="other-list">${row()}</div><div data-testid="list" style="height:100px">${content}</div>`);
        await expect(expectStatementList(page.getByTestId('list'), [statement])).rejects.toThrow();
      });
    }

    test('空响应不能接受遗留条目，离屏列表不能冒充当前页', async ({ page }) => {
      await page.setContent(`<div data-testid="list">${row()}</div>`);
      await expect(expectStatementList(page.getByTestId('list'), [])).rejects.toThrow();
      await page.setContent(`<div data-testid="list" style="position:absolute;left:2000px">${row()}</div>`);
      await expect(expectStatementList(page.getByTestId('list'), [statement])).rejects.toThrow();
    });
  });
}
