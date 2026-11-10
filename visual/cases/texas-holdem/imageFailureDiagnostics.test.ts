import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page, TestInfo } from '@playwright/test';
import { saveImageFailureDiagnostics } from './imageFailureDiagnostics';

test('图片失败附件脱敏资源且只读一次页面', /** 验证持久化边界隐藏地址、路径及查询凭据。 */ async () => {
  let reads = 0;
  let body = '';
  const page = { evaluate: /** 模拟原始失败状态，不提供时钟或请求能力。 */ async () => {
    reads++;
    return [{ resource: 'https://private.invalid/card.png?token=secret', complete: true, width: 10 }];
  } } as unknown as Page;
  const info = { attach: /** 保存附件以验证脱敏边界。
   * @param _name - 附件名称。
   * @param options - 附件内容。 */ async (_name: string, options: { body: string }) => { body = options.body; } } as unknown as TestInfo;
  await saveImageFailureDiagnostics(page, info, 'signed_in_texas_game');
  await saveImageFailureDiagnostics(page, info, 'signed_in_zhajinhua_game');
  assert.equal(reads, 2);
  assert.match(body, /asset-[a-f0-9]{16}/);
  for (const privateValue of ['private.invalid', 'card.png', 'token', 'secret']) assert.ok(!body.includes(privateValue));
});

test('诊断读取或保存失败不传播异常', /** 验证取证失败不会替换原始截图异常。 */ async () => {
  const page = { evaluate: /** 模拟仍可读取的页面。 */ async () => [] } as unknown as Page;
  const info = { attach: /** 模拟附件保存错误。 */ async () => { throw new Error('diagnostic failure'); } } as unknown as TestInfo;
  await saveImageFailureDiagnostics(page, info, 'signed_in_texas_game');
  const broken = { evaluate: /** 模拟页面已经关闭。 */ async () => { throw new Error('page closed'); } } as unknown as Page;
  await saveImageFailureDiagnostics(broken, info, 'signed_in_texas_game');
});
