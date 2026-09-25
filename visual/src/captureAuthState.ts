/**
 * 登录态采集：整个运行前登录一次，把 localStorage 登录态存到 auth-state.json，
 * 之后每个登录场景由 pageSetup 直接注入，免去逐场景的 UI 登录
 * （每场景省 ~30-60s，并消除登录偶发失败）。
 *
 * staging 偶发请求超时时会用新 context 重试；全部失败后由调用方中止本轮。
 * 不能让并行场景各自回退 UI 登录：同一账号重复登录会互相作废 token。
 */

import { chromium } from '@playwright/test';
import fs from 'fs';
import { LANGUAGE_STORAGE_KEY } from '../scenarios';
import { ensureAppReadyPastStaging, ensureSignedIn, waitForSignInState } from './support/authFlow';
import {
  AUTH_STATE_PATH,
  disableAnimations,
  FIXED_COUNTRY_PHONE_CODE,
  fixNavigatorLanguage,
  mockVisualNetworkDependencies,
} from './support/pageSetup';
import { runWithContext } from './support/runWithContext';

const baseUrl = process.env.VISUAL_BASE_URL || 'http://127.0.0.1:8080';
const username = process.env.VISUAL_USERNAME || 'laiwanvisual01';
const password = process.env.VISUAL_PASSWORD || 'visual2026test';
const deviceId = process.env.VISUAL_DEVICE_ID || 'a7f3c2e8-4d61-4b0a-9c5e-7f2d1e3a8b46';
const MAX_CAPTURE_ATTEMPTS = Number(process.env.VISUAL_AUTH_CAPTURE_ATTEMPTS || 3);

const BROWSER_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-gpu-compositing',
  '--disable-skia-runtime-opts',
  '--num-raster-threads=1',
  '--run-all-compositor-stages-before-draw',
  '--disable-new-content-rendering-timeout',
  '--disable-threaded-animation',
  '--disable-threaded-scrolling',
  '--disable-checker-imaging',
  '--disable-image-animation-resync',
  '--disable-partial-raster',
  '--disable-features=PaintHolding',
  '--disable-lcd-text',
  '--disable-font-subpixel-positioning',
  '--font-render-hinting=none',
  '--force-color-profile=srgb',
  '--force-device-scale-factor=1',
  '--lang=en-US',
];

const TUTORIAL_COMPLETE_KEYS = [
  'hall.screen.tutorial.complete.key',
  'personal.house.screen.tutorial.complete.key',
  'create.room.screen.tutorial.complete.key',
];

async function createAuthContext(
  browser: import('@playwright/test').Browser,
  storageEntries?: Record<string, string>,
) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    storageState: storageEntries
      ? {
          cookies: [],
          origins: [
            {
              origin: new URL(baseUrl).origin,
              localStorage: Object.entries(storageEntries).map(([name, value]) => ({
                name,
                value,
              })),
            },
          ],
        }
      : undefined,
  });
  await fixNavigatorLanguage(context);
  await disableAnimations(context);
  // 登录态采集与场景必须使用同一套启动网络 mock；否则采集会在代理选址阶段
  // 随机命中 server_load_offline 节点，尚未显示登录入口就失败。
  await mockVisualNetworkDependencies(context);
  await context.addInitScript(
    ({
      device,
      langKey,
      tutorialKeys,
    }: {
      device: string;
      langKey: string;
      tutorialKeys: string[];
    }) => {
      window.localStorage.setItem(langKey, 'zh-Hans');
      window.localStorage.setItem('deviceId', device);
      for (const key of tutorialKeys) {
        window.localStorage.setItem(key, 'true');
      }
    },
    { device: deviceId, langKey: LANGUAGE_STORAGE_KEY, tutorialKeys: TUTORIAL_COMPLETE_KEYS },
  );
  return context;
}

async function collectLocalStorageEntries(page: import('@playwright/test').Page) {
  const entries: Record<string, string> = await page.evaluate(() => {
    const all: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key) {
        all[key] = window.localStorage.getItem(key) || '';
      }
    }
    return all;
  });
  // 语言由各场景自行设置，不能带进注入态
  delete entries[LANGUAGE_STORAGE_KEY];
  entries['app.user.country.code.key'] = FIXED_COUNTRY_PHONE_CODE;
  return entries;
}

function persistAuthState(entries: Record<string, string>) {
  fs.writeFileSync(
    AUTH_STATE_PATH,
    JSON.stringify({ capturedAt: new Date().toISOString(), username, entries }, null, 2),
    'utf8',
  );
  console.log(
    `AUTH STATE > 登录态已保存到 ${AUTH_STATE_PATH}（${Object.keys(entries).length} 个键）`,
  );
}

async function validateCapturedAuthState(
  browser: import('@playwright/test').Browser,
  entries: Record<string, string>,
): Promise<Record<string, string>> {
  const context = await createAuthContext(browser, entries);

  return runWithContext(context, async () => {
    const page = await context.newPage();
    page.on('response', (response) => {
      if (response.status() === 401) {
        console.log(`AUTH STATE > 注入验证收到 401：${response.url()}`);
      }
    });
    await page.goto(baseUrl, { waitUntil: 'load', timeout: 120000 });
    await ensureAppReadyPastStaging(page);
    const valid = (await waitForSignInState(page, { requireAppState: true })) === 'signedIn';
    console.log(`AUTH STATE > 新 context 注入验证：${valid ? '成功' : '失败'}`);
    if (!valid) {
      throw new Error('采集的登录态无法注入新 context');
    }
    // 验证 context 启动期间，应用可能补齐用户资料、Centrifuge 或刷新后的认证缓存。
    // 必须保存这份已通过账户校验且完成应用稳定窗口后的快照；若继续写入验证前
    // 的 entries，后续场景会重新注入旧缓存，导致“验证成功、场景立即登出”。
    return collectLocalStorageEntries(page);
  });
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ args: BROWSER_LAUNCH_ARGS });

  try {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= MAX_CAPTURE_ATTEMPTS; attempt += 1) {
      const context = await createAuthContext(browser);
      try {
        console.log(`AUTH STATE > 采集尝试 ${attempt}/${MAX_CAPTURE_ATTEMPTS}`);
        const page = await context.newPage();
        await page.goto(baseUrl, { waitUntil: 'load', timeout: 120000 });
        await ensureAppReadyPastStaging(page);
        await page
          .waitForFunction(() => !document.querySelector('[role="progressbar"]'), {
            timeout: 60000,
          })
          .catch(() => undefined);

        await ensureSignedIn(page, { username, password });
        const entries = await collectLocalStorageEntries(page);
        const validatedEntries = await validateCapturedAuthState(browser, entries);
        persistAuthState(validatedEntries);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(
          `AUTH STATE > 第 ${attempt}/${MAX_CAPTURE_ATTEMPTS} 次采集失败：${lastError.message}`,
        );
      } finally {
        await context.close();
      }

      if (attempt < MAX_CAPTURE_ATTEMPTS) {
        await new Promise((resolve) => {
          setTimeout(resolve, 2000);
        });
      }
    }

    throw lastError || new Error('登录态采集失败');
  } finally {
    await browser.close();
  }
}

main().catch((error: Error) => {
  console.error(`AUTH STATE > 登录态采集连续失败：${error.message}`);
  try {
    fs.rmSync(AUTH_STATE_PATH, { force: true });
  } catch {
    // ignore
  }
  process.exitCode = 1;
});
