import { expect, type Locator, type Response } from '@playwright/test';

type Currency = 'coin' | 'diamond';
export type Statement = {
  currency_name: Currency | '金币' | '钻石';
  amount: string;
  balance: string;
  event: 'deposit' | 'withdraw';
  create_at: string;
  memo: string;
  statement_id: string;
};

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
      memo: expect.any(String),
      statement_id: expect.stringMatching(/\S/),
    });
    expect(Number.isFinite(Date.parse(statement.create_at)), '流水时间应可解析').toBe(true);
  }
  return statements;
}

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
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }, statement.create_at);
  await expect(row).toBeInViewport();
  await expect(row.getByTestId('CurrencyTransactionRecordItem_amount'))
    .toHaveText(`${statement.event === 'deposit' ? '+' : '-'}${statement.amount}`);
  await expect(row.getByTestId('CurrencyTransactionRecordItem_balance')).toHaveText(`余额: ${statement.balance}`);
  await expect(row.getByTestId('CurrencyTransactionRecordItem_date')).toHaveText(date);
}
