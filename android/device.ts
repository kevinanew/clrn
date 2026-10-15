import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { _android, type AndroidDevice } from 'playwright';
import { expect, type TestInfo } from '@playwright/test';
import { dismissKeyboard } from './keyboard';
import { maskScreenshot, type ScreenshotMask } from './screenshot';
import { samePixels } from './motion-regions';
// @ts-expect-error 元数据验证模块也供纯 Node 下载入口使用。
import { applicationId, packageName, readVerifiedBuild } from './release.mjs';

export { applicationId };
export const artifacts = path.join(__dirname, 'artifacts/current');

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
 * @param options - 牌桌使用修复持续动画查询的固定版本原生驱动。
 */
export async function launchApplication(options: { gameDriver?: boolean } = {}): Promise<AndroidDevice> {
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
  adb('shell', 'settings', 'put', 'secure', 'spell_checker_enabled', '0');
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
  if (options.gameDriver) {
    const driver = path.resolve('.ttyctl/android-driver');
    const source = JSON.parse(readFileSync(path.join(driver, 'source.json'), 'utf8'));
    if (source.revision !== '39e3553a4f283a41134d75d7e404484bd9e6865a' || source.patch !== 3) throw new Error('牌桌驱动构建身份无效。');
    for (const pkg of ['com.microsoft.playwright.androiddriver.test', 'com.microsoft.playwright.androiddriver']) {
      if (adb('shell', 'pm', 'list', 'packages', pkg).includes(`package:${pkg}`)) adb('uninstall', pkg);
    }
    for (const apk of ['android-driver-target.apk', 'android-driver.apk']) adb('install', path.join(driver, apk));
  }
  const devices = await _android.devices({ omitDriverInstall: options.gameDriver === true });
  const device = devices.find(item => item.serial() === process.env.ANDROID_SERIAL);
  await Promise.all(devices.filter(item => item !== device).map(item => item.close()));
  if (!device) throw new Error('未找到指定模拟器。');
  device.setDefaultTimeout(30_000);
  // 此套件只操作原生控件；后台 WebView 探测的 ADB FAIL 会误关整个连接。
  // 关闭无用的浏览器发现，不重试或吞掉原生控件、截图及应用自身的错误。
  const implementation = (device as unknown as { _connection: { toImpl(device: AndroidDevice): {
    _pollingWebViews?: NodeJS.Timeout; _refreshWebViews(): Promise<void> } } })._connection.toImpl(device);
  clearTimeout(implementation._pollingWebViews);
  implementation._refreshWebViews = /** 原生测试无需发现可调试的 WebView。 */ async () => {};
  return device;
}

/**
 * 完整通过测试环境确认，再等待正常初始化完成；不取消任何初始化错误。
 * @param device - 专用模拟器连接。
 */
export async function waitForHall(device: AndroidDevice): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await device.wait({ res: 'staging-confirmation-input' }, { timeout: 30_000 }); break; }
    catch (error) {
      // CI 系统桌面偶发 ANR 会遮住应用；只关闭明确属于 Pixel Launcher 的弹窗。
      const launcher = await device.info({ text: "Pixel Launcher isn't responding" }).catch(() => undefined);
      if (attempt >= 2) throw error;
      if (!launcher) continue;
      console.log('ANDROID > 关闭 Pixel Launcher 系统桌面 ANR，重新等待应用启动');
      await device.tap({ res: 'android:id/aerr_close' });
    }
  }
  await device.fill({ res: 'staging-confirmation-input' }, 'CONFIRM');
  await dismissKeyboard(device);
  await device.tap({ res: 'confirm-button' });
  await device.wait({ res: 'settings-tab' }, { timeout: 120_000 });
}

/**
 * 连续截图稳定后进行像素比较，拒绝把加载态或动画帧作为基准。
 * @param device - 专用模拟器连接。
 * @param name - 截图场景名称。
 * @param testInfo - Playwright 当前测试报告。
 * @param masks - 明确排除的动态区域，报告保留原图和区域原因。
 * @param transientState - 短时提示的可见性断言；普通页面仍须稳定两秒。
 * @param takeScreenshot - 短时提示使用同一设备上的快速原生截图接口。
 */
export async function compareScreenshot(device: AndroidDevice, name: string, testInfo: TestInfo, masks: ScreenshotMask[] = [],
  transientState?: () => Promise<void>, takeScreenshot: () => Promise<Buffer> = () => device.screenshot()): Promise<void> {
  if (masks.length) await testInfo.attach(`${name}-masks`, { body: JSON.stringify(masks), contentType: 'application/json' });
  await transientState?.();
  const initial = await takeScreenshot();
  await transientState?.();
  let previous = maskScreenshot(initial, masks);
  let stabilityReference = previous;
  let stableSince = Date.now();
  let stable: Buffer | undefined;
  let original: Buffer | undefined;
  let comparisonBefore = previous;
  let comparisonAfter = previous;
  await expect(async () => {
    await transientState?.();
    original = await takeScreenshot();
    await transientState?.();
    const current = maskScreenshot(original, masks);
    comparisonBefore = previous;
    comparisonAfter = current;
    // 稳定检测与最终基准使用同一比较器；不把 GPU 的单色阶抖动当作持续动画。
    // 固定本段稳定期的参考帧，避免连续缓慢变化通过逐帧小差异累积漂移。
    const equal = samePixels(current, stabilityReference);
    previous = current;
    if (!equal) { stableSince = Date.now(); stabilityReference = current; }
    expect(equal, '页面像素必须保持稳定').toBe(true);
    expect(Date.now() - stableSince, '普通页面等待滚动条淡出；短时提示须在可见期间连续稳定')
      .toBeGreaterThanOrEqual(transientState ? 250 : 2000);
    stable = current;
  }).toPass({ timeout: 30_000, intervals: [transientState ? 100 : 500] }).catch(async error => {
    // 保留最后两帧及既有遮罩说明，便于定位真实动态区域，不自动扩大容差。
    await testInfo.attach(`${name}-unstable-before`, { body: comparisonBefore, contentType: 'image/png' });
    await testInfo.attach(`${name}-unstable-after`, { body: comparisonAfter, contentType: 'image/png' });
    throw error;
  });
  if (masks.length) {
    await testInfo.attach(`${name}-original`, { body: original!, contentType: 'image/png' });
  }
  await testInfo.attach(name, { body: stable!, contentType: 'image/png' });
  expect.soft(stable!).toMatchSnapshot(`${name}.png`);
}
