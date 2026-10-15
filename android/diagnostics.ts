import type { AndroidDevice } from 'playwright';
import type { TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { adb } from './device';

/**
 * 保留失败截图和完整控件树；失败后 Playwright 会重建 worker，允许释放原生驱动。
 * @param device - 出错时的专用模拟器连接。
 * @param testInfo - 当前失败报告。
 */
export async function captureFailure(device: AndroidDevice, testInfo: TestInfo): Promise<void> {
  await device.screenshot().then(async body => {
    const filename = testInfo.outputPath('last-screen.png');
    await writeFile(filename, body);
    await testInfo.attach('last-screen', { path: filename, contentType: 'image/png' });
  }).catch(() => undefined);
  try {
    const filename = testInfo.outputPath('runtime.log');
    const hostLog = process.env.GITHUB_ACTIONS === 'true'
      ? await readFile(path.join(tmpdir(), `adb.${process.getuid!()}.log`), 'utf8').catch(() => '') : '';
    const logs = [adb('logcat', '-d', '-b', 'all', '*:E'), hostLog,
      adb('logcat', '-d', '-b', 'all', 'adbd:I', 'init:I', 'lmkd:I', 'lowmemorykiller:I', '*:S'),
      adb('shell', 'cat', '/proc/meminfo'),
      adb('logcat', '-d', '-b', 'events', 'am_kill:I', 'am_proc_died:I', 'am_crash:I', 'am_anr:I', '*:S')].join('\n').split('\n')
      .filter(line => !/(access_token|refresh_token|authorization|password|Bearer\s)/i.test(line)
        && !(process.env.VISUAL_PASSWORD && line.includes(process.env.VISUAL_PASSWORD))).join('\n');
    await writeFile(filename, logs);
    await testInfo.attach('runtime', { path: filename, contentType: 'text/plain' });
  } catch { /* 截图和控件树仍可用于诊断。 */ }
  await device.close().catch(() => undefined);
  try {
    // UiAutomation 同时只允许一个连接；先释放驱动，再用系统工具读取完整树。
    adb('shell', 'am', 'force-stop', 'com.microsoft.playwright.androiddriver');
    adb('shell', 'rm', '-f', '/sdcard/clrn-visual-hierarchy.xml');
    adb('shell', 'uiautomator', 'dump', '/sdcard/clrn-visual-hierarchy.xml');
    const hierarchy = adb('shell', 'cat', '/sdcard/clrn-visual-hierarchy.xml')
      .replace(/<node\b[^>]*password="true"[^>]*>/g, node => node.replace(/text="[^"]*"/, 'text="[redacted]"'));
    const filename = testInfo.outputPath('hierarchy.xml');
    await writeFile(filename, hierarchy);
    await testInfo.attach('hierarchy', { path: filename, contentType: 'application/xml' });
  } catch (error) {
    await testInfo.attach('hierarchy-error', { body: String(error), contentType: 'text/plain' }).catch(() => undefined);
  }
}
