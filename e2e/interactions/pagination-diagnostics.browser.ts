/** 以真实浏览器输入验证诊断不会接管手势、泄漏页面数据或遗留监听。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, devices, type TestInfo } from '@playwright/test';
import { observePaginationGesture } from './pagination-diagnostics';
import { drag } from './gestures';

test('分页诊断记录真实触摸结束与取消，保持页面和业务监听不变并排除敏感字段', async () => {
  const browser = await chromium.launch();
  try {
    for (const touch of [false, true]) {
      const context = await browser.newContext(touch ? devices['Pixel 7'] : devices['Desktop Chrome']);
      const page = await context.newPage();
      await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1">
        <div data-testid="game-buy-in-application-list-screen" style="width:300px;height:500px;touch-action:none">
          <div role="tab" aria-selected="true" aria-label="不应保存的账号">不应保存的正文</div>
          <div data-testid="game-buy-in-application-list" style="height:450px;transform:translateX(-12px)">
            <div data-testid="不应保存的动态标记">不应保存的令牌</div>
          </div>
        </div>`);
      await page.evaluate(/** 安装独立业务监听，用于检查诊断是否干扰事件。 */ () => {
        document.body.dataset.delivered = '0';
        document.addEventListener('touchend', /** 记录业务实际收到的触摸结束事件。 */ () => {
          document.body.dataset.delivered = String(Number(document.body.dataset.delivered) + 1);
        });
        document.addEventListener('mousedown', /**
         * 模拟业务正常阻止默认行为。
         * @param event - 原始鼠标事件。
         */ event => event.preventDefault());
      });
      const before = await page.getByTestId('game-buy-in-application-list-screen').evaluate(
        /** 保存原始页面以核对只读性。
         * @param element - 申请页节点。
         */ element => element.outerHTML,
      );
      const inspector = await context.newCDPSession(page);
      const documentObject = await inspector.send('Runtime.evaluate', { expression: 'document' });
      const objectId = documentObject.result.objectId!;
      const originalListeners = await inspector.send('DOMDebugger.getEventListeners', { objectId });
      const diagnostics = await observePaginationGesture(page);
      await diagnostics.mark('进入申请页前');
      await diagnostics.begin();
      await drag(page, { x: 270, y: 200 }, { x: 30, y: 200 }, touch);
      if (touch) {
        const session = await context.newCDPSession(page);
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 200, id: 1 }] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await session.detach();
        assert.equal(await page.locator('body').getAttribute('data-delivered'), '1', '原业务仍应收到一次真实触摸结束');
      }
      await page.evaluate(/** 制造有界采集压力，不影响已记录的真实输入。 */ () => {
        for (let count = 0; count < 500; count += 1) document.dispatchEvent(new MouseEvent('mousemove'));
      });
      let saved = '';
      const info = { project: { use: { ...(touch ? devices['Pixel 7'] : devices['Desktop Chrome']), baseURL: '不应保存的连接地址',
        storageState: '不应保存的存储路径' } },
      attach: /** 捕获已筛选的报告内容。
       * @param name - 附件名称。
       * @param attachment - 附件正文。
       */ async (name: string, attachment: { body: string }) => {
        assert.equal(name, '分页手势诊断');
        saved = attachment.body;
      } } as unknown as TestInfo;
      await diagnostics.save(info);
      assert.ok(!saved.includes('不应保存'), '附件不得包含正文、账号、令牌、连接地址或完整项目配置');
      const result = JSON.parse(saved);
      assert.equal(result.records.length, 300, '诊断记录应有固定上限');
      assert.ok(result.dropped > 0, '超过上限必须报告丢弃数量');
      assert.equal(result.records.at(-1).phase, '选中断言结束', '超过上限仍应保留最后状态');
      const events = result.records.filter((record: { kind: string }) => record.kind === 'input');
      assert.ok(events.some((event: { type: string; trusted: boolean }) =>
        event.type === (touch ? 'touchend' : 'mouseup') && event.trusted), '应记录浏览器真实分发的结束事件');
      if (touch) assert.ok(events.some((event: { type: string }) => event.type === 'touchcancel'), '应保留取消事件以区分中断');
      else {
        const start = events.find((event: { type: string }) => event.type === 'mousedown');
        assert.equal(start.defaultPreventedAtCapture, false, '捕获阶段还未经过业务处理');
        assert.equal(start.defaultPreventedAtBubble, true, '冒泡阶段应保留业务阻止默认行为的证据');
      }
      assert.deepEqual(result.records[0].tabs, ['true'], '应保留选中状态而不记录标签文字');
      assert.equal(result.records[0].viewport.width, touch ? devices['Pixel 7'].viewport.width : devices['Desktop Chrome'].viewport.width);
      assert.ok(result.records[0].layers.some((layer: { transform: string }) =>
        layer.transform === 'matrix(1, 0, 0, 1, -12, 0)'), '应保留组件实际位移');
      assert.equal(await page.getByTestId('game-buy-in-application-list-screen').evaluate(
        /** 诊断完成后复查原页面。
         * @param element - 申请页节点。
         */ element => element.outerHTML,
      ), before, '诊断不得修改页面样式、内容或标签状态');
      const remainingListeners = await inspector.send('DOMDebugger.getEventListeners', { objectId });
      assert.equal(remainingListeners.listeners.length, originalListeners.listeners.length, '保存后必须移除全部诊断监听');
      await inspector.detach();
      await context.close();
    }
  } finally { await browser.close(); }
});

test('触摸目标卸载后仍保留失联证据，完整输入命令不等于文档收到结束事件', async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext(devices['Pixel 7']);
    const page = await context.newPage();
    await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1">
      <div data-testid="game-buy-in-application-list-screen" style="width:300px;height:500px;overflow:hidden">
        <div data-testid="game-buy-in-application-list" style="width:300px;height:500px">加载中的占位内容</div>
      </div>`);
    await page.evaluate(/** 模拟首屏读取完成后卸载加载列表，不改动手势样式。 */ () => {
      let moves = 0;
      document.addEventListener('touchmove', /**
       * 在第三次真实移动后更换首屏内容。
       * @param event - 浏览器分发的真实触摸事件。
       */ event => {
        moves += 1;
        if (moves === 3 && event.target instanceof Element) {
          const target = event.target;
          queueMicrotask(/** 等本次事件分发结束后卸载原目标。 */ () => target.remove());
        }
      }, { capture: true, passive: true });
    });
    const diagnostics = await observePaginationGesture(page);
    await diagnostics.begin();
    // 使用生产输入工具，十二次移动及结束命令必须全部成功返回。
    await drag(page, { x: 270, y: 200 }, { x: 30, y: 200 }, true);
    let saved = '';
    await diagnostics.save({ project: { use: devices['Pixel 7'] },
      attach: /** 保存白名单快照以检查目标连接状态。
       * @param _name - 附件名称。
       * @param attachment - 附件正文。
       */ async (_name: string, attachment: { body: string }) => { saved = attachment.body; },
    } as unknown as TestInfo);
    const result = JSON.parse(saved);
    const inputs = result.records.filter((record: { kind: string }) => record.kind === 'input');
    assert.equal(inputs.filter((event: { type: string }) => event.type === 'touchmove').length, 3,
      '目标卸载后，后续移动不再经过文档监听');
    assert.ok(!inputs.some((event: { type: string }) => event.type === 'touchend'),
      '不能把输入命令成功返回当作文档收到触摸结束');
    assert.equal(result.records.at(-1).touchTarget.connected, false, '目标卸载后仍应保存断开的节点身份');
    assert.equal(result.records.at(-1).touchTarget.marker, 'game-buy-in-application-list');
    assert.ok(!saved.includes('占位内容'), '节点卸载诊断也不得采集正文');
    await context.close();
  } finally { await browser.close(); }
});
