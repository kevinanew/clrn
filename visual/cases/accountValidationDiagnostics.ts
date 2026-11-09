import { test, type BrowserContext, type Page } from '@playwright/test';
import type { Mitmproxy } from '../../e2e/helpers/mitmproxy-client';
import type { VisualScenario } from '../scenarioTypes';
import { installConnectionDiagnostics } from '../src/support/connectionDiagnostics';

/** 安装只读采集器，返回不会抛出异常的保存方法。
 * @param scenario - 当前场景。
 * @param context - 场景上下文。
 * @param page - 导航前页面。
 * @param network - 场景代理。 */
export async function accountValidationDiagnostics(scenario: VisualScenario, context: BrowserContext,
  page: Page, network: Mitmproxy): Promise<(error: unknown) => Promise<void>> {
  let diagnostics: Awaited<ReturnType<typeof installConnectionDiagnostics>> | undefined;
  try {
    if (['signed_in_bind_phone'].includes(scenario.pageLabel)) {
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
