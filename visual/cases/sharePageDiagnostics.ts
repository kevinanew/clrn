import { test, type BrowserContext, type Page } from '@playwright/test';
import type { Mitmproxy } from '../../e2e/helpers/mitmproxy-client';
import type { VisualScenario } from '../scenarioTypes';
import { installConnectionDiagnostics } from '../src/support/connectionDiagnostics';

/** 为登录场景账户超时保存代理快照；采集和保存失败均不改变原测试结果。
 * @param scenario - 当前视觉场景。
 * @param context - 场景独占上下文。
 * @param page - 导航前页面。
 * @param network - 当前场景的真实代理。
 * @param action - 不改变采样和断言的原场景。 */
export async function withSharePageDiagnostics(scenario: VisualScenario, context: BrowserContext,
  page: Page, network: Mitmproxy, action: () => Promise<void>): Promise<void> {
  const save = await sharePageDiagnostics(scenario, context, page, network);
  try { await action(); } catch (error) { await save(error); throw error; }
}

/** 安装只读采集器，返回不会抛出异常的保存方法。
 * @param scenario - 当前场景。
 * @param context - 场景上下文。
 * @param page - 导航前页面。
 * @param network - 场景代理。 */
async function sharePageDiagnostics(scenario: VisualScenario, context: BrowserContext,
  page: Page, network: Mitmproxy): Promise<(error: unknown) => Promise<void>> {
  let diagnostics: Awaited<ReturnType<typeof installConnectionDiagnostics>> | undefined;
  try {
    if (scenario.pageLabel.startsWith('signed_in_')) {
      diagnostics = await installConnectionDiagnostics(context, page, test.info(), {
        /** 只读查询现有代理快照，不发起额外账户请求。 */
        diagnostics: () => network.command('diagnostics', undefined, 2000),
      });
    }
  } catch { /* 采集失败仍继续原场景。 */ }
  return (/** 保存诊断失败时保留原始异常。
   * @param error - 场景原始异常。 */ async (error: unknown): Promise<void> => {
    try { await diagnostics?.save(error); } catch { /* 保留原始测试异常。 */ }
  });
}
