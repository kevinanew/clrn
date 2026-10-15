import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

// 固定官方驱动源码；改进控件查询与真实截图采集，不修改被测 APK、绘制或游戏时钟。
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
    'for (int i = 0; i < node.getChildCount(); ++i) {\n      AccessibilityNodeInfo child = node.getChild(i);\n      if (child != null) children.put(serializeA11yNode(child));\n    }')
  .replace('private static JSONObject tree(UiDevice device)', `
  // 短时提示只查询当前节点，避免前后断言重复序列化整棵牌桌树而错过提示。
  private static JSONObject marker(AccessibilityNodeInfo node, String resource) throws JSONException {
    if (node == null) return null;
    if (resource.equals(node.getViewIdResourceName())) {
      Rect bounds = new Rect();
      node.getBoundsInScreen(bounds);
      if (!bounds.isEmpty()) return info(node);
    }
    // 浮层位于绘制树末尾；从前景向背景遍历，避免提示查询逐个跨进程读取整张牌桌。
    for (int index = node.getChildCount() - 1; index >= 0; index--) {
      JSONObject found = marker(node.getChild(index), resource);
      if (found != null) return found;
    }
    return null;
  }

  private static JSONObject tree(UiDevice device)`)
  .replace('case "tree":', `case "transientFrames":
              // 先采集真实位图，再压缩传输，避免 PNG 编码耗尽短时提示的显示时间。
              java.util.ArrayList<android.graphics.Bitmap> bitmaps = new java.util.ArrayList<>();
              JSONArray frames = new JSONArray();
              long deadline = android.os.SystemClock.uptimeMillis() + 3000;
              long firstFrame = 0;
              try {
                while (android.os.SystemClock.uptimeMillis() < deadline && bitmaps.size() < 8) {
                  AccessibilityNodeInfo root = getRootA11yNode(device);
                  JSONObject before = marker(root, params.getString("resource"));
                  if (before == null) {
                    if (!bitmaps.isEmpty()) break;
                    android.os.SystemClock.sleep(20);
                    continue;
                  }
                  JSONObject panel = marker(root, "toastTouchableContainer");
                  android.graphics.Bitmap frame = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
                  if (frame == null) throw new IllegalStateException("Native screenshot returned no bitmap");
                  long capturedAt = android.os.SystemClock.uptimeMillis();
                  JSONObject after = marker(getRootA11yNode(device), params.getString("resource"));
                  if (after == null) { frame.recycle(); break; }
                  bitmaps.add(frame);
                  frames.put(new JSONObject().put("before", before).put("after", after)
                    .put("panel", panel).put("capturedAt", capturedAt));
                  if (firstFrame == 0) firstFrame = capturedAt;
                  if (capturedAt - firstFrame >= 900) break;
                  android.os.SystemClock.sleep(100);
                }
                for (int index = 0; index < bitmaps.size(); index++) {
                  java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                  if (!bitmaps.get(index).compress(android.graphics.Bitmap.CompressFormat.PNG, 100, bytes))
                    throw new IllegalStateException("Native screenshot PNG encoding failed");
                  frames.getJSONObject(index).put("png", android.util.Base64.encodeToString(bytes.toByteArray(), android.util.Base64.NO_WRAP));
                }
                response.put("result", frames);
              } finally { for (android.graphics.Bitmap frame : bitmaps) frame.recycle(); }
              break;
            case "screen":
              android.graphics.Bitmap bitmap = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
              if (bitmap == null) throw new IllegalStateException("Native screenshot returned no bitmap");
              try {
                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                if (!bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, bytes))
                  throw new IllegalStateException("Native screenshot PNG encoding failed");
                response.put("result", android.util.Base64.encodeToString(bytes.toByteArray(), android.util.Base64.NO_WRAP));
              } finally { bitmap.recycle(); }
              break;
            case "marker":
              JSONObject found = marker(getRootA11yNode(device), params.getString("resource"));
              response.put("result", found == null ? JSONObject.NULL : found);
              break;
            case "tree":`);
if (!['setWaitForIdleTimeout(100)', 'if (child != null)', 'case "marker":', 'case "screen":', 'case "transientFrames":']
  .every(fragment => patched.includes(fragment))) throw new Error('原生驱动补丁没有完整应用。');
writeFileSync(java, patched);
const gradle = path.join(directory, 'build.gradle');
writeFileSync(gradle, readFileSync(gradle, 'utf8').replaceAll('jcenter()', 'mavenCentral()'));
execFileSync(path.join(directory, 'gradlew'), ['--no-daemon', ':app:assembleDebug', ':app:assembleAndroidTest'],
  { cwd: directory, stdio: 'inherit', timeout: 600_000 });
const output = path.resolve('.ttyctl/android-driver');
mkdirSync(output, { recursive: true });
copyFileSync(path.join(directory, 'app/build/outputs/apk/debug/app-debug.apk'), path.join(output, 'android-driver-target.apk'));
copyFileSync(path.join(directory, 'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'), path.join(output, 'android-driver.apk'));
writeFileSync(path.join(output, 'source.json'), JSON.stringify({ revision, patch: 3 }));
console.log('原生控件驱动已构建，应用画面和动画保持原样。');
