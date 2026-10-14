import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { _android, type AndroidDevice } from 'playwright';
import { expect, type TestInfo } from '@playwright/test';
// @ts-expect-error 元数据验证模块也供纯 Node 下载入口使用。
import { applicationId, packageName, readVerifiedBuild } from './release.mjs';

export const artifacts = fileURLToPath(new URL('./artifacts/current', import.meta.url));

/**
 * 执行限定模拟器的 Android 调试命令，拒绝默认选中手机。
 * @param argumentsList - adb 参数列表。
 */
export function adb(...argumentsList: string[]): string {
  const serial = process.env.ANDROID_SERIAL || '';
  if (!/^emulator-\d+$/.test(serial)) throw new Error('必须通过 ANDROID_SERIAL 指定专用模拟器，例如 emulator-5554。');
  return execFileSync('adb', ['-s', serial, ...argumentsList], { encoding: 'utf8', timeout: 120_000 });
}

/**
 * 安装已校验的 Release 并固定系统显示条件，正常冷启动应用。
 */
export async function launchApplication(): Promise<AndroidDevice> {
  await readVerifiedBuild(artifacts);
  if (adb('shell', 'getprop', 'ro.kernel.qemu').trim() !== '1') throw new Error('只允许在专用模拟器执行。');
  if (adb('shell', 'getprop', 'ro.build.version.sdk').trim() !== '35') throw new Error('截图基准要求 Android API 35。');
  if (process.env.GITHUB_ACTIONS === 'true' && adb('shell', 'getprop', 'ro.product.cpu.abi').trim() !== 'x86_64') {
    throw new Error('CI 正式截图基准要求 x86_64 模拟器。');
  }
  const locale = adb('shell', 'getprop', 'persist.sys.locale').trim() || adb('shell', 'getprop', 'ro.product.locale').trim();
  if (!['en-US', 'en_US'].includes(locale)) throw new Error(`截图基准要求 en-US 系统语言，当前为 ${locale}。`);
  adb('shell', 'wm', 'size', '720x1280');
  adb('shell', 'wm', 'density', '320');
  adb('shell', 'cmd', 'overlay', 'enable-exclusive', '--category', 'com.android.internal.systemui.navbar.gestural');
  adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0');
  adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
  adb('shell', 'settings', 'put', 'system', 'user_rotation', '0');
  for (const setting of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) {
    adb('shell', 'settings', 'put', 'global', setting, '0');
  }
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  adb('shell', 'wm', 'dismiss-keyguard');
  // 系统时钟、电量和通知不属于应用视觉基准，隐藏这些变化的系统图标。
  adb('shell', 'cmd', 'statusbar', 'send-disable-flag', 'clock', 'system-icons', 'notification-icons');
  // 只删除这个专用测试应用，以兼容不同 Release 的测试签名和清除旧会话。
  if (adb('shell', 'pm', 'list', 'packages', applicationId).includes(`package:${applicationId}`)) adb('uninstall', applicationId);
  adb('install', `${artifacts}/${packageName}`);
  const information = JSON.parse(readFileSync(`${artifacts}/build-info.json`, 'utf8'));
  const installed = adb('shell', 'dumpsys', 'package', applicationId);
  if (!installed.includes(`versionName=${information.versionName}`)) throw new Error('安装后的应用版本与 Release 不一致。');
  adb('logcat', '-c');
  adb('shell', 'am', 'start', '-n', `${applicationId}/com.laiwan_react_native.MainActivity`);
  const devices = await _android.devices();
  const device = devices.find(item => item.serial() === process.env.ANDROID_SERIAL);
  await Promise.all(devices.filter(item => item !== device).map(item => item.close()));
  if (!device) throw new Error('未找到指定模拟器。');
  device.setDefaultTimeout(30_000);
  return device;
}

/**
 * 完整通过测试环境确认，再等待正常初始化完成；不取消任何初始化错误。
 * @param device - 专用模拟器连接。
 */
export async function waitForHall(device: AndroidDevice): Promise<void> {
  await device.wait({ res: 'staging-confirmation-input' }, { timeout: 90_000 });
  await device.fill({ res: 'staging-confirmation-input' }, 'CONFIRM');
  await device.input.press('Back');
  await device.tap({ res: 'confirm-button' });
  await device.wait({ res: 'settings-tab' }, { timeout: 120_000 });
}

/**
 * 连续截图稳定后进行像素比较，拒绝把加载态或动画帧作为基准。
 * @param device - 专用模拟器连接。
 * @param name - 截图场景名称。
 * @param testInfo - Playwright 当前测试报告。
 */
export async function compareScreenshot(device: AndroidDevice, name: string, testInfo: TestInfo): Promise<void> {
  let previous = await device.screenshot();
  let stable: Buffer | undefined;
  await expect(async () => {
    const current = await device.screenshot();
    const equal = current.equals(previous);
    previous = current;
    expect(equal, '页面必须连续两帧保持稳定').toBe(true);
    stable = current;
  }).toPass({ timeout: 30_000, intervals: [1000] });
  await testInfo.attach(name, { body: stable!, contentType: 'image/png' });
  expect.soft(stable!).toMatchSnapshot(`${name}.png`);
}
