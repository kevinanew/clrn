import assert from 'node:assert/strict';
import test from 'node:test';
import type { Response } from '@playwright/test';
import { clubIdentifier, isCreatedClub, readCreatedRoom, expectCreatedRoom, closeGuestContexts } from './created-resource';

const id = '11111111-2222-4333-8444-555555555555';

for (const body of [{}, { ok: false, result: { room_id: id } }, { ok: true },
  { ok: true, result: { room_id: 'unrelated-room' } }]) {
  test(`不登记非成功或无效房间：${JSON.stringify(body)}`, /** 非本例成功响应不能产生可清理 ID。 */ async () => {
    const captured: unknown[] = [];
    const response = { json: /** 读取本例响应。 */ async () => body } as unknown as Response;
    assert.equal(await readCreatedRoom(response, /** 记录可清理房间。
     * @param room - 解析到的房间。 */ room => captured.push(room)), body);
    assert.deepEqual(captured, []);
  });
}

test('先记录本次精确房间，再把正文交给 UI 和 HTTP 断言', /** UI 后续失败仍有精确 ID 可供清理。 */ async () => {
  const body = { ok: true, result: { room_id: id } };
  const captured: unknown[] = [];
  const response = { json: /** 返回创建正文。 */ async () => body,
    url: /** 只使用创建请求自己的来源。 */ () => 'https://synthetic.invalid/v3/pay_action/do' } as unknown as Response;
  const result = await readCreatedRoom(response, /** 保存清理状态。
   * @param room - 本次房间。 */ room => captured.push(room));
  assert.equal(result, body);
  assert.deepEqual(captured, [{ id, origin: 'https://synthetic.invalid', cleanupUrl: `https://synthetic.invalid/v1/room/${id}` }]);
});

test('正文解析失败仍传播，不能生成房间清理状态', /** 读取异常不能转换成创建成功。 */ async () => {
  const error = new Error('synthetic parse failure');
  const response = { json: /** 注入实际解析失败。 */ async () => { throw error; } } as unknown as Response;
  await assert.rejects(readCreatedRoom(response, /** 解析失败不应调用登记。 */ () => assert.fail('不得登记房间')), error);
});

for (const result of [{ id }, { club_id: id }, { id: '', club_id: id }]) {
  test(`保留两种俱乐部 ID 字段和真值回退：${JSON.stringify(result)}`, /** 仅成功且合法的 ID 可登记俱乐部。 */ () => {
    assert.equal(clubIdentifier({ result }), id);
    assert.equal(isCreatedClub({ ok: true, result }), true);
    assert.equal(isCreatedClub({ ok: false, result }), false);
  });
}

test('访客按顺序关闭，关闭失败仍传播并阻止后续关闭', /** 保留原有循环的时序和错误传播。 */ async () => {
  const closed: number[] = [];
  const error = new Error('synthetic close failure');
  await assert.rejects(closeGuestContexts([
    { context: { close: /** 先关闭第一个访客。 */ async () => { closed.push(1); } } },
    { context: { close: /** 第二个访客关闭失败。 */ async () => { closed.push(2); throw error; } } },
    { context: { close: /** 不应继续关闭第三个访客。 */ async () => { closed.push(3); } } },
  ]), error);
  assert.deepEqual(closed, [1, 2]);
});


test('HTTP 失败仍保留已捕获房间，后续断言失败不能阻断清理登记', /** 保留业务创建成功但 HTTP 校验失败时的清理语义。 */ async () => {
  const captured: { id: string }[] = [];
  const response = { json: /** 成功业务响应可生成本次房间。 */ async () => ({ ok: true, result: { room_id: id } }),
    url: /** 保留创建请求来源。 */ () => 'https://synthetic.invalid/v3/pay_action/do',
    ok: /** 模拟 HTTP 失败，不能吞掉断言。 */ () => false } as unknown as Response;
  const body = await readCreatedRoom(response, /** 先保存清理状态。
   * @param room - 本次房间。 */ room => captured.push(room));
  assert.throws(/** 后续 HTTP 断言仍必须失败。 */ () => expectCreatedRoom(response, body, captured[0].id));
  assert.equal(captured[0].id, id);
});
