/** 用真实 Chromium 验证德州倒计时后的连接恢复和截图就绪门禁，无需 staging 账号。 */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { waitForGameConnection } from '../cases/texas-holdem/connectionReadiness';
import { installConnectionDiagnostics } from '../src/support/connectionDiagnostics';

/**
 * 重现倒计时先出现、房主开始按钮和工具栏尚未完成初始化的页面。
 * @param page - 隔离的浏览器页面。
 * @param mode - 点击应用重试后恢复、持续失败或缺少房主状态。
 */
async function renderTable(page: Page, mode = 'recover'): Promise<void> {
  await page.setContent(`
    <div data-testid="countdown-text">等待開始 0s</div>
    <div id="controls" hidden>
      <button data-testid="texas-holdem-start-room-timer-button">開始</button>
      <button data-testid="menu-button">選單</button>
      <button data-testid="texas-holdem-leaderboard-button">排行榜</button>
    </div>
    <div data-testid="game-splash-screen-bg" hidden>載入中</div>
    <div data-testid="common-alert-container" hidden>
      Network Error
      <button data-testid="common-alert-button-cancel">取消</button>
      <button data-testid="common-alert-button-retry">重試</button>
    </div>
    <script>
      document.body.dataset.retries = '0';
      document.body.dataset.mode = '${mode}';
      document.querySelector('[data-testid="common-alert-button-retry"]').onclick = () => {
        document.body.dataset.retries = String(Number(document.body.dataset.retries) + 1);
        if (document.body.dataset.mode === 'persistent') return;
        document.querySelector('[data-testid="common-alert-container"]').hidden = true;
        if (document.body.dataset.mode === 'recover') document.querySelector('#controls').hidden = false;
      };
    </script>
  `);
}

/**
 * 展示应用错误弹窗，保留已经出现的倒计时。
 * @param page - 当前牌桌页面。
 */
async function showError(page: Page): Promise<void> {
  await page.getByTestId('common-alert-container').evaluate(
    /** 显示错误弹窗，恢复操作必须由真实按钮点击触发。
     * @param element - 应用错误弹层。
     */ element => { (element as HTMLElement).hidden = false; },
  );
}

/**
 * 完成房主状态和工具栏的初始化。
 * @param page - 当前牌桌页面。
 */
async function showControls(page: Page): Promise<void> {
  await page.locator('#controls').evaluate(
    /** 同时显示开始按钮和工具栏。
     * @param element - 房主控件容器。
     */ element => { (element as HTMLElement).hidden = false; },
  );
}

for (const width of [375, 1440]) {
  test(`${width} 像素繁体牌桌完整就绪时直接通过`,
    /** 验证正常连接不点击重试。
     * @param fixtures - Playwright 隔离页面。
     */ async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await renderTable(page);
      await showControls(page);
      await waitForGameConnection(page, 3000);
      await expect(page.locator('body')).toHaveAttribute('data-retries', '0');
    },
  );

  test(`${width} 像素倒计时出现后晚到的 Network Error 仍通过应用重试恢复`,
    /** 第一轮检查已看到倒计时后再弹出错误，重现 issue 115 的时序。
     * @param fixtures - Playwright 隔离页面。
     */ async ({ page, context }) => {
      await page.setViewportSize({ width, height: 900 });
      const diagnostics = await installConnectionDiagnostics(context, page, test.info());
      await renderTable(page);
      const pending = waitForGameConnection(page, 5000);
      await expect.poll(/** 等待第一次就绪检查完成，避免依赖定时器碰运气。 */
        () => diagnostics.recorder.events.length).toBeGreaterThan(0);
      await showError(page);
      await pending;
      await expect(page.locator('body')).toHaveAttribute('data-retries', '1');
      await expect(page.getByTestId('texas-holdem-start-room-timer-button')).toBeVisible();
      await expect(page.getByTestId('common-alert-container')).toBeHidden();
      expect(diagnostics.recorder.events.map(
        /** 提取阶段以检查倒计时、重试和完成的先后顺序。
         * @param event - 脱敏诊断记录。
         */ event => event.phase,
      )).toEqual(['德州初始化状态', '德州初始化状态', '点击应用重试按钮', '德州初始化状态', '德州初始化完成']);
    },
  );
}

test('控件已可见但错误弹窗仍在时必须重试，不能提前接受截图',
  /** 验证 DOM 中可见的底层控件不能绕过阻塞弹层。
   * @param fixtures - Playwright 隔离页面。
   */ async ({ page }) => {
    await renderTable(page);
    await showControls(page);
    await showError(page);
    await waitForGameConnection(page, 3000);
    await expect(page.locator('body')).toHaveAttribute('data-retries', '1');
  },
);

for (const missing of ['countdown-text', 'texas-holdem-start-room-timer-button',
  'menu-button', 'texas-holdem-leaderboard-button']) {
  test(`缺少 ${missing} 时即使其他控件已就绪也必须失败`,
    /** 验证每一项就绪条件不可省略，隐藏副本不能补足缺失控件。
     * @param fixtures - Playwright 隔离页面。
     */ async ({ page }) => {
      await renderTable(page);
      await showControls(page);
      await page.getByTestId(missing).evaluate(
        /** 保留隐藏节点，验证只接受可见控件。
         * @param element - 本例缺失的业务控件。
         */ element => { (element as HTMLElement).hidden = true; },
      );
      await expect(waitForGameConnection(page, 500)).rejects.toThrow('德州牌桌应完整就绪');
    },
  );
}

for (const blocker of ['game-splash-screen-bg', 'common-alert-container']) {
  test(`${blocker} 未消失时不得视为连接完成`,
    /** 验证加载遮罩和不可重试错误保留失败边界。
     * @param fixtures - Playwright 隔离页面。
     */ async ({ page }) => {
      await renderTable(page);
      await showControls(page);
      await page.getByTestId('common-alert-button-retry').evaluate(
        /** 模拟没有重试入口的业务错误。
         * @param element - 重试按钮。
         */ element => { element.remove(); },
      );
      await page.getByTestId(blocker).evaluate(
        /** 显示本例的阻塞层。
         * @param element - 加载遮罩或错误弹层。
         */ element => { (element as HTMLElement).hidden = false; },
      );
      await expect(waitForGameConnection(page, 500)).rejects.toThrow('德州牌桌应完整就绪');
    },
  );
}

test('错误消失但房主初始化未完成时仍失败',
  /** 不能把成功点击重试等同于业务初始化完成。
   * @param fixtures - Playwright 隔离页面。
   */ async ({ page }) => {
    await renderTable(page, 'incomplete');
    await showError(page);
    await expect(waitForGameConnection(page, 750)).rejects.toThrow('德州牌桌应完整就绪');
    await expect(page.locator('body')).toHaveAttribute('data-retries', '1');
    await expect(page.getByTestId('common-alert-container')).toBeHidden();
  },
);

test('持续 Network Error 最多重试三次，超时保留失败时序与诊断附件',
  /** 验证错误不会变成成功，也不会无限点击或丢失诊断。
   * @param fixtures - Playwright 隔离页面和上下文。
   */ async ({ page, context }) => {
    const diagnostics = await installConnectionDiagnostics(context, page, test.info());
    await renderTable(page, 'persistent');
    await showError(page);
    await expect(waitForGameConnection(page, 2500)).rejects.toThrow('德州牌桌应完整就绪');
    await expect(page.locator('body')).toHaveAttribute('data-retries', '3');
    await expect(page.getByTestId('common-alert-container')).toBeVisible();
    await diagnostics.save(new Error('德州初始化失败'));
    const saved = JSON.parse(await readFile(test.info().outputPath('connection-diagnostics.json'), 'utf8'));
    expect(saved.events).toContainEqual(expect.objectContaining({
      phase: '德州初始化失败', attempt: 3, limit: 3, timeoutMs: 2500,
    }));
    expect(saved.events.at(-1)).toMatchObject({ event: 'test.failure' });
    expect(test.info().attachments.map(
      /** 核对完整事件和可读摘要都已保存。
       * @param attachment - Playwright 报告附件。
       */ attachment => attachment.name,
    )).toEqual(['connection-diagnostics', 'connection-summary']);
  },
);

test('重试按钮被遮挡时点击也必须受初始化总预算约束',
  /** 验证 Playwright 动作超时不会在轮询预算之外再等待十五秒。
   * @param fixtures - Playwright 隔离页面。
   */ async ({ page }) => {
    await renderTable(page);
    await showError(page);
    await page.locator('body').evaluate(
      /** 添加拦截真实点击的覆盖层，不删除或禁用应用按钮。
       * @param body - 当前页面正文。
       */ body => {
        const cover = document.createElement('div');
        cover.style.cssText = 'position:fixed;inset:0;z-index:9999';
        body.appendChild(cover);
      },
    );
    const started = Date.now();
    await expect(waitForGameConnection(page, 750)).rejects.toThrow('德州牌桌应完整就绪');
    expect(Date.now() - started).toBeLessThan(2500);
    await expect(page.locator('body')).toHaveAttribute('data-retries', '0');
    await expect(page.getByTestId('common-alert-container')).toBeVisible();
  },
);
