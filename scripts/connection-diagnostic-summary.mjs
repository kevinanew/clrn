/** 测试后将脱敏连接摘要写入 GitHub 作业摘要，完整时间线由现有报告附件保存。 */
import { appendFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * 收集当前任务的用例摘要；文件缺失时保持原任务结果。
 * @param directory - Playwright 结果目录。
 */
async function summaries(directory) {
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await summaries(location));
    else if (entry.name === 'connection-summary.md') result.push(await readFile(location, 'utf8'));
  }
  return result;
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const reports = await summaries('visual/test-results');
  const failures = reports.filter(report => report.includes('test.failure'));
  const selected = failures.length ? failures : reports;
  let size = 0;
  for (const report of selected) {
    // GitHub 单步摘要有大小限制；不切断 Markdown 块，完整版本仍在附件内。
    const bytes = Buffer.byteLength(report);
    if (size + bytes > 800000) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, '\n其余诊断请下载完整 Playwright 报告。\n');
      break;
    }
    await appendFile(process.env.GITHUB_STEP_SUMMARY, report + '\n');
    size += bytes;
  }
}
