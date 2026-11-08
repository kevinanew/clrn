/** 每条测试命令创建独立会话，持续记录步骤/输出并在 outputDir 被下一命令清理前保留附件。 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullConfig, FullResult, Reporter, TestCase, TestResult, TestStep, TestError } from '@playwright/test/reporter';
import { DiagnosticLog, DiagnosticOutput, diagnosticCaseDirectory, logError, logText } from './diagnostic-log';

/** 在 reporter 和 worker 间关联同一用例日志，原始失败结果始终由 Playwright 决定。 */
export default class DiagnosticReporter implements Reporter {
  private runner?: DiagnosticLog;
  private cases = new Map<TestResult, DiagnosticLog>();
  private outputs = new Map<DiagnosticLog, { stdout: DiagnosticOutput; stderr: DiagnosticOutput }>();

  /**
   * 在任何 fixture 执行前写入构建、命令和运行身份。
   * @param config - 当前 Playwright 配置。
   */
  onBegin(config: FullConfig): void {
    const root = process.env.CLRN_DIAGNOSTICS_DIR || path.resolve(__dirname, '../../.ci-diagnostics');
    const directory = path.join(root, randomUUID());
    process.env.CLRN_DIAGNOSTIC_SESSION = directory;
    this.runner = new DiagnosticLog(directory, 'runner');
    const identity = {
      runId: process.env.GITHUB_RUN_ID || 'local', runAttempt: process.env.GITHUB_RUN_ATTEMPT || '1',
      job: process.env.GITHUB_JOB || 'local', shard: config.shard,
      testCommit: process.env.GITHUB_SHA || 'local',
      applicationCommit: process.env.CLRN_EXPECTED_APPLICATION_COMMIT || 'unavailable',
      releaseTag: process.env.CLRN_RELEASE_TAG || 'unavailable',
      suite: process.env.VISUAL_SUITE || 'e2e', part: process.env.ANIMATION_PART || 'unavailable',
      startedAt: Date.now(),
    };
    this.runner.save('identity.json', identity);
    this.runner.record('run.start');
  }

  /**
   * 测试开始时就落盘，worker 被终止仍能识别未完成用例。
   * @param test - 用例及项目。
   * @param result - 当前尝试。
   */
  onTestBegin(test: TestCase, result: TestResult): void {
    const log = new DiagnosticLog(diagnosticCaseDirectory({ testId: test.id, ...result, repeatEachIndex: test.repeatEachIndex }), 'steps');
    this.cases.set(result, log);
    this.saveCase(test, result, 'running');
    log.record('test.start');
  }

  /**
   * 记录每个动作发出及实际定位器；输入值不进入副本。
   * @param _test - 当前用例。
   * @param result - 当前尝试。
   * @param step - Playwright 的真实步骤。
   */
  onStepBegin(_test: TestCase, result: TestResult, step: TestStep): void {
    this.cases.get(result)?.record('test.step-start', this.stepFields(step));
  }

  /**
   * 驱动完成不等同于应用处理；应用处理仅由原断言或已有应用事件证明。
   * @param _test - 当前用例。
   * @param result - 当前尝试。
   * @param step - 已结束步骤。
   */
  onStepEnd(_test: TestCase, result: TestResult, step: TestStep): void {
    this.cases.get(result)?.record('test.step-end', { ...this.stepFields(step), elapsedMs: step.duration,
      outcome: step.error ? 'failed' : 'driver-completed', ...(step.error ? logError(step.error.message) : {}) });
  }

  /**
   * 只记录 API 名和脱敏目标，不序列化参数或附加网络数据。
   * @param step - 运行器提供的动作。
   */
  private stepFields(step: TestStep): Record<string, unknown> {
    const title = step.title.replace(/^(Fill|Type|Insert text)\s+".*?"/i, '$1 [输入值已隐藏]');
    return { stepId: step.titlePath().map(/** 使用脱敏步骤路径区分同名的嵌套动作。
      * @param item - 步骤标题。
      */ item => logText(item.replace(/^(Fill|Type|Insert text)\s+".*?"/i, '$1 [输入值已隐藏]'))).join(' > '),
      target: logText(title), category: step.category };
  }

  /**
   * 保存测试执行输出，清理和退出期间也持续记录。
   * @param chunk - 标准输出。
   * @param _test - 可选关联用例。
   * @param result - 可选关联尝试。
   */
  onStdOut(chunk: string | Buffer, _test?: TestCase, result?: TestResult): void {
    this.output(result)?.stdout.write(chunk);
  }

  /**
   * 保存脱敏标准错误，保持源级别和原始退出状态。
   * @param chunk - 标准错误。
   * @param _test - 可选关联用例。
   * @param result - 可选关联尝试。
   */
  onStdErr(chunk: string | Buffer, _test?: TestCase, result?: TestResult): void {
    this.output(result)?.stderr.write(chunk);
  }

  /**
   * 为每个用例和运行级来源保留独立的行缓冲。
   * @param result - 可选用例尝试。
   */
  private output(result?: TestResult) {
    const log = result ? this.cases.get(result) : this.runner;
    if (!log) return;
    if (!this.outputs.has(log)) this.outputs.set(log, {
      stdout: new DiagnosticOutput(log, 'test.stdout'), stderr: new DiagnosticOutput(log, 'test.stderr'),
    });
    return this.outputs.get(log);
  }

  /**
   * 用例结束立刻复制现有安全附件，避免后续命令清空失败现场。
   * @param test - 当前用例。
   * @param result - 原始执行结果。
   */
  onTestEnd(test: TestCase, result: TestResult): void {
    const log = this.cases.get(result);
    if (!log) return;
    this.outputs.get(log)?.stdout.flush();
    this.outputs.get(log)?.stderr.flush();
    log.record('test.end', { status: result.status, elapsedMs: result.duration,
      errors: result.errors.map(/** 错误副本不携带原始堆栈、cause 或私有正文。
       * @param error - 运行器原始错误。
       */ error => logError(error.message)) });
    this.saveCase(test, result, result.status);
    result.attachments.forEach(/** 仅保留现有截图、录像、脱敏连接诊断，拒绝 trace 和认证缓存。
     * @param attachment - 原报告附件。
     * @param index - 附件序号。
     */ (attachment, index) => {
      const connection = /^connection-(?:diagnostics|summary)$/.test(attachment.name);
      const extension = path.extname(attachment.path || '') || (attachment.name === 'connection-summary' ? '.md' : '.json');
      const visual = ['.png', '.jpg', '.jpeg', '.webm'].includes(extension);
      if (!(visual || connection)) return;
      const target = path.join(log.directory, `attachment-${index}${extension}`);
      try {
        if (attachment.path) copyFileSync(attachment.path, target);
        else if (attachment.body && connection) writeFileSync(target, attachment.body);
        else return;
        log.record('test.attachment', { file: path.basename(target), name: logText(attachment.name) });
      } catch (error) { log.record('collection.attachment-unavailable', logError(error)); }
    });
  }

  /**
   * 写入用例、设备、重试和构建的关联元数据，不依赖测试正常结束。
   * @param test - 当前用例。
   * @param result - 当前尝试。
   * @param status - 原始状态或 running。
   */
  private saveCase(test: TestCase, result: TestResult, status: string): void {
    const project = test.parent.project();
    this.cases.get(result)!.save('case.json', {
      title: logText(test.titlePath().join(' / ')), project: logText(project?.name),
      viewport: project?.use.viewport, device: logText(project?.use.userAgent || 'project-default'),
      retry: result.retry, repeat: test.repeatEachIndex, worker: result.workerIndex,
      status, expectedStatus: test.expectedStatus, startedAt: result.startTime.getTime(), duration: result.duration,
    });
  }

  /**
   * 全局错误也必须可下载，不能只依赖单例失败回调。
   * @param error - 测试发现、worker 或全局准备错误。
   */
  onError(error: TestError): void { this.runner?.record('run.error', logError(error.message)); }

  /**
   * 记录实际运行结果，不提供覆盖退出码的返回值。
   * @param result - Playwright 的最终结果。
   */
  onEnd(result: FullResult): void {
    for (const output of this.outputs.values()) { output.stdout.flush(); output.stderr.flush(); }
    this.runner?.record('run.end', { status: result.status });
  }
}
