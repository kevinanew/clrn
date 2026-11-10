import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { JSHandle, Page, TestInfo } from '@playwright/test';

const paginationObserverSource = readFileSync(path.join(__dirname, 'pagination-observer.browser.js'), 'utf8');

type Observation = {
  snapshot: (phase: string) => void;
  begin: () => void;
  finish: () => { version: number; records: unknown[]; dropped: number };
};

/**
 * 观察分页手势的真实输入和布局；只记录数值与固定标记，不读取账号、正文、地址或存储。
 * @param page - 当前真实交互页面。
 */
export async function observePaginationGesture(page: Page) {
  // 浏览器代码使用字符串，避免本机 TypeScript 转译辅助函数进入页面。
  const observation = await page.evaluateHandle(paginationObserverSource) as JSHandle<Observation>;
  return {
    /**
     * 保存一次阶段快照。
     * @param phase - 不含业务数据的固定阶段名。
     */
    async mark(phase: string) { await observation.evaluate(/** 在浏览器中保存当前阶段的分页观测快照。
 * @param observer - 当前操作使用的 observer。
 * @param value - 当前待转换或校验的值。 */ (observer, value) => observer.snapshot(value), phase); },
    /** 开始观察原始横滑，不改变输入参数。 */
    async begin() { await observation.evaluate(/** 启动浏览器内的分页手势观测，记录后续原始输入。
 * @param observer - 当前操作使用的 observer。 */ observer => observer.begin()); },
    /**
     * 将白名单诊断附到桌面或触屏报告，用于对照成功与失败的实际事件。
     * @param info - 当前用例报告。
     */
    async save(info: TestInfo) {
      try {
        const result = await observation.evaluate(/** 结束分页观测并取回安全的诊断记录。
 * @param observer - 当前操作使用的 observer。 */ observer => observer.finish());
        await info.attach('分页手势诊断', { body: JSON.stringify({ ...result,
          configured: { viewport: info.project.use.viewport, isMobile: info.project.use.isMobile,
            hasTouch: info.project.use.hasTouch, deviceScaleFactor: info.project.use.deviceScaleFactor } }),
        contentType: 'application/json' });
      } finally { await observation.dispose(); }
    },
  };
}
