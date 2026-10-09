import { expect, type Locator, type Response } from '@playwright/test';

type Currency = 'coin' | 'diamond';
export type Statement = {
  currency_name: Currency | '金币' | '钻石';
  amount: string;
  balance: string;
  event: 'deposit' | 'withdraw';
  create_at: string;
  memo: string | null;
  statement_id: string;
};

/**
 * 校验真实钱包流水响应的结构和币种，并返回交易记录。
 * @param response - 需要校验的 HTTP 响应。
 * @param currency - 本次查询的币种代码。
 */
export async function readStatements(response: Response, currency: Currency): Promise<Statement[]> {
  expect(response.ok(), `${currency} 流水 HTTP 应成功`).toBe(true);
  const body = await response.json();
  expect(body, `${currency} 流水业务成功、币种及数组结构应正确`).toMatchObject({
    ok: true,
    result: { currency_name: currency, statements: expect.any(Array) },
  });
  const statements: Statement[] = body.result.statements;
  for (const statement of statements) {
    expect(statement, `${currency} 每条流水应属于目标币种且字段完整`).toMatchObject({
      // result 使用币种代码，真实简中接口的条目使用本地化名称。
      currency_name: expect.stringMatching(currency === 'coin' ? /^(coin|金币)$/ : /^(diamond|钻石)$/),
      amount: expect.stringMatching(/^\d+(?:\.\d+)?$/),
      balance: expect.stringMatching(/^-?\d+(?:\.\d+)?$/),
      event: expect.stringMatching(/^(deposit|withdraw)$/),
      create_at: expect.any(String),
      statement_id: expect.stringMatching(/\S/),
    });
    // 后端 show_detail 保留合法的空备注；缺失字段或其他类型仍明确失败。
    expect(statement.memo === null || typeof statement.memo === 'string', '流水备注应为字符串或 null').toBe(true);
    expect(Number.isFinite(Date.parse(statement.create_at)), '流水时间应可解析').toBe(true);
  }
  return statements;
}

/**
 * 核对流水列表中的真实交易或空态，兼容虚拟列表只挂载首条记录。
 * @param list - 钱包流水列表定位器。
 * @param statements - 真实接口返回并通过校验的流水记录。
 */
export async function expectStatementList(list: Locator, statements: Statement[]): Promise<void> {
  await expect(list).toBeInViewport();
  const rows = list.getByTestId('CurrencyTransactionRecordItem_container');
  if (!statements.length) {
    // 合法空流水无需创建业务数据，也不能显示其他币种遗留的条目。
    await expect(rows).toHaveCount(0);
    return;
  }
  // FlatList 会虚拟化长列表；核对首条真实流水，限定在当前币种列表内。
  const row = rows.first();
  const statement = statements[0];
  const date = await list.evaluate((_, value) => {
    const date = new Date(value);
    /**
     * 将日期分量补齐为两位数字，与页面时间格式保持一致。
     * @param part - 需要补零的日期或时间分量。
     */
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }, statement.create_at);
  await expect(row).toBeInViewport();
  await expect(row.getByTestId('CurrencyTransactionRecordItem_amount'))
    .toHaveText(`${statement.event === 'deposit' ? '+' : '-'}${statement.amount}`);
  await expect(row.getByTestId('CurrencyTransactionRecordItem_balance')).toHaveText(`余额: ${statement.balance}`);
  await expect(row.getByTestId('CurrencyTransactionRecordItem_date')).toHaveText(date);
}
