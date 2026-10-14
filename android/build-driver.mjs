import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

// 固定官方驱动源码；只修正控件查询，不修改被测 APK、绘制或游戏时钟。
const revision = '39e3553a4f283a41134d75d7e404484bd9e6865a';
const checkout = path.resolve(process.argv[2] || '.ttyctl/playwright-driver-source');
const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
if (actual !== revision) throw new Error('原生驱动必须从固定的官方 Playwright 1.61.1 提交构建。');
const directory = path.join(checkout, 'packages/playwright-core/src/server/android/driver');
const java = path.join(directory, 'app/src/androidTest/java/com/microsoft/playwright/androiddriver/InstrumentedTest.java');
// 每次从 Git 读取原文，重复构建也不会叠加补丁。
const source = execFileSync('git', ['show', `${revision}:packages/playwright-core/src/server/android/driver/app/src/androidTest/java/com/microsoft/playwright/androiddriver/InstrumentedTest.java`],
  { cwd: checkout, encoding: 'utf8' });
if (createHash('sha256').update(source).digest('hex') !== '289f2df123807de9382c86b205c62cf6fe4b03bad28ff46dd129d5664fb8fa2a') {
  throw new Error('官方驱动源码校验失败。');
}
const patched = source
  .replace('UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());',
    'androidx.test.uiautomator.Configurator.getInstance().setWaitForIdleTimeout(100);\n    UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());')
  .replace('for (int i = 0; i < node.getChildCount(); ++i)\n      children.put(serializeA11yNode(node.getChild(i)));',
    'for (int i = 0; i < node.getChildCount(); ++i) {\n      AccessibilityNodeInfo child = node.getChild(i);\n      if (child != null) children.put(serializeA11yNode(child));\n    }');
if (!patched.includes('setWaitForIdleTimeout(100)') || !patched.includes('if (child != null)')) throw new Error('原生驱动补丁没有完整应用。');
writeFileSync(java, patched);
const gradle = path.join(directory, 'build.gradle');
writeFileSync(gradle, readFileSync(gradle, 'utf8').replaceAll('jcenter()', 'mavenCentral()'));
execFileSync(path.join(directory, 'gradlew'), ['--no-daemon', ':app:assembleDebug', ':app:assembleAndroidTest'],
  { cwd: directory, stdio: 'inherit', timeout: 600_000 });
const output = path.resolve('.ttyctl/android-driver');
mkdirSync(output, { recursive: true });
copyFileSync(path.join(directory, 'app/build/outputs/apk/debug/app-debug.apk'), path.join(output, 'android-driver-target.apk'));
copyFileSync(path.join(directory, 'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'), path.join(output, 'android-driver.apk'));
writeFileSync(path.join(output, 'source.json'), JSON.stringify({ revision, patch: 1 }));
console.log('原生控件驱动已构建，应用画面和动画保持原样。');
