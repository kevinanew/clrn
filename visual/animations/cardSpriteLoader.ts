/** 固定历史构建的 ImageLoader 回调取证；仅独立对照启用，不改写构建文件或组件状态。 */
import type { CDPSession, Page, TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { cardSpriteResource } from './cardSpritePrivacy';

const applicationCommit = '69f9251d3b5f2b93aa2d880d27abbeefe16ee645';
// 经原 Release 实读的完整方法形状，拒绝猜测其他压缩版本的局部变量。
export const loaderMethod = 'load(e,t,s){n+=1;var l=new window.Image;return l.onerror=s,l.onload=e=>{var n=()=>t({nativeEvent:e});'
  + "'function'==typeof l.decode?l.decode().then(n,n):setTimeout(n,0)},l.src=e,o[\"\"+n]=l,n}";
export const loaderAbortMethod = 'abort(e){var t=o[""+e];t&&(t.onerror=null,t.onload=null,t=null,delete o[""+e])}';
type LoaderEvent = { request: number; phase: 'registered' | 'native-load' | 'abort' | 'enter' | 'return' | 'throw'; resource: string; virtualTime: number };

/**
 * 从已校验 Release 查找唯一支持的加载器；不保存源码、源映射或连接信息。
 * @param directory - 原包的本地文件目录。
 */
async function findLoader(directory: string): Promise<{ filename: string; source: string }[]> {
  const found: { filename: string; source: string }[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await findLoader(filename));
    else if (entry.name.endsWith('.js')) {
      const source = await readFile(filename, 'utf8');
      if (source.includes(loaderMethod) && source.includes(loaderAbortMethod)) found.push({ filename, source });
    }
  }
  return found;
}

/**
 * 包装真实 ImageLoader 成功回调的同步边界，保留接收者、参数、返回值和异常。
 * @param page - 尚未导航的独立取证页。
 * @param info - 当前用例的私有附件目录。
 */
export async function installCardSpriteLoader(page: Page, info: TestInfo): Promise<() => Promise<void>> {
  if (process.env.CLRN_EXPECTED_APPLICATION_COMMIT !== applicationCommit || !process.env.CLRN_RELEASE_WEB_ROOT) {
    throw new Error('ImageLoader 回调观察只支持 #68 的原固定 Release');
  }
  const matches = await findLoader(process.env.CLRN_RELEASE_WEB_ROOT);
  if (matches.length !== 1) throw new Error('未唯一识别受支持的 ImageLoader；不能冒充回调已取证');
  const { filename, source } = matches[0];
  if (source.indexOf(loaderMethod) !== source.lastIndexOf(loaderMethod)) throw new Error('ImageLoader 方法不唯一');
  const journal = info.outputPath('card-sprite-loader.jsonl');
  let sequence = 0;
  appendFileSync(journal, JSON.stringify({ schema: 1, applicationCommit,
    scriptSha256: createHash('sha256').update(source).digest('hex'),
    limitations: '回调参数被包装，观察可能影响调度；resource 仅关联同一资源，不证明多个 DOM 中的某一个身份。'
      + 'enter/return 是实际 ImageLoader 成功回调的同步边界，不等于 React 已提交。' }) + '\n');
  await page.exposeBinding('__clrnImageLoaderEvent', /** 将白名单内的图片加载事件脱敏后追加到宿主诊断日志。
 * @param _binding - 当前操作使用的 _binding。
 * @param event - 当前触发的事件。 */ (_binding, event: LoaderEvent) => {
    // 白名单输出，不保存异常正文、回调参数或任意浏览器对象。
    appendFileSync(journal, JSON.stringify({ sequence: ++sequence, realTime: Date.now(),
      virtualTime: event.virtualTime, request: event.request, phase: event.phase,
      resource: cardSpriteResource(event.resource) }) + '\n');
  });
  await page.addInitScript(`(() => {
    'use strict';
    const pending = new Set();
    const images = new WeakMap();
    const resources = new Map();
    const emit = (request, phase, resource) => {
      let logicalResource;
      try {
        const url = new URL(resource, location.href);
        logicalResource = /^https?:$/.test(url.protocol) ? url.pathname : '[' + url.protocol + ']';
      } catch { logicalResource = '[invalid]'; }
      const result = window.__clrnImageLoaderEvent({ request, phase, resource: logicalResource, virtualTime: Date.now() });
      pending.add(result);
      result.finally(() => pending.delete(result)).catch(() => {});
    };
    window.__clrnFlushImageLoader = async () => { await Promise.all(Array.from(pending)); };
    window.__clrnImageLoaderNative = image => {
      const request = images.get(image);
      if (request !== undefined) emit(request, 'native-load', resources.get(request));
    };
    window.__clrnImageLoaderAbort = request => {
      if (resources.has(request)) emit(request, 'abort', resources.get(request));
    };
    window.__clrnObserveImageLoader = (callback, request, resource, image) => {
      if (image) images.set(image, request);
      resources.set(request, resource);
      emit(request, 'registered', resource);
      return function(...args) {
        emit(request, 'enter', resource);
        try {
          const result = Reflect.apply(callback, this, args);
          emit(request, 'return', resource);
          return result;
        } catch (error) { emit(request, 'throw', resource); throw error; }
      };
    };
  })();`);
  const session: CDPSession = await page.context().newCDPSession(page);
  await session.send('Debugger.enable');
  const breakpoints = await installLoaderBreakpoints(session, filename, source);
  return /** 刷新页面加载器事件并检查日志记录是否存在，完成最终取证。 */ async () => {
    try {
      await page.evaluate(/** 等待页面中尚未落盘的图片加载事件全部提交。 */ async () => {
        const state = window as typeof window & { __clrnFlushImageLoader: () => Promise<void> };
        await state.__clrnFlushImageLoader();
      });
      if (sequence === 0) throw new Error('ImageLoader 观察器没有取得真实调用，不能标记取证成功');
    } finally {
      for (const breakpointId of breakpoints) await session.send('Debugger.removeBreakpoint', { breakpointId });
      await session.detach();
      await info.attach('card-sprite-loader', { path: journal, contentType: 'application/x-ndjson' });
    }
  };
}

/**
 * 固定原压缩方法的语句位置；条件恒为 false，不暂停页面或改写构建字节。
 * @param session - 独立页面的 Chromium 调试会话。
 * @param filename - 已校验构建中的脚本名。
 * @param source - 已校验的脚本内容，仅用于定位，不进入报告。
 */
async function installLoaderBreakpoints(session: CDPSession, filename: string, source: string): Promise<string[]> {
  const start = source.indexOf(loaderMethod);
  const probes = [
    { offset: start + loaderMethod.indexOf('return l.onerror'),
      condition: '(t=window.__clrnObserveImageLoader(t,n,e,l),false)' },
    { offset: start + loaderMethod.indexOf('var n=()=>'), condition: '(window.__clrnImageLoaderNative(l),false)' },
    { offset: source.indexOf(loaderAbortMethod) + 'abort(e){'.length,
      condition: '(window.__clrnImageLoaderAbort(e),false)' },
  ];
  const identifiers: string[] = [];
  try {
    for (const probe of probes) {
      const before = source.slice(0, probe.offset).split('\n');
      const result = await session.send('Debugger.setBreakpointByUrl', {
        urlRegex: path.basename(filename).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$',
        lineNumber: before.length - 1, columnNumber: before.at(-1)!.length, condition: probe.condition,
      });
      identifiers.push(result.breakpointId);
    }
    return identifiers;
  } catch (error) {
    await session.detach();
    throw error;
  }
}
