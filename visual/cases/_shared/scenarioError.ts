/** 游戏场景错误展示的脱敏处理，保留原对象和传播语义。 */
import { diagnosticText } from '../../../e2e/helpers/diagnostic-privacy';

/**
 * 保留原始错误对象和传播路径，只脱敏展示字段。
 * @param error - 场景抛出的错误。
 */
export function sanitizeScenarioError(error: unknown) {
  if (error instanceof Error) { error.message = diagnosticText(error.message); error.stack = diagnosticText(error.stack); }
}
