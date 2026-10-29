import assert from 'node:assert/strict';
import test from 'node:test';
import { cardSpriteResource } from './cardSpritePrivacy';
import { installCardSpriteDiagnostics, sampleCardSprites, saveCardSpriteDiagnostics } from './cardSpriteDiagnostics';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import type { Page, TestInfo } from '@playwright/test';

test('图集资源使用逻辑指纹，路径中的连接入口、编码和凭据不会原样保留', () => {
  const inputs = [
    '/assets/probe.example.invalid/card.png', '/assets/192.0.2.7/card.png',
    '/assets/[2001:db8::7]/card.png', '/assets/2001:db8::7/card.png',
    '/assets/probe%2eexample%2einvalid/card.png', '/assets/192%2e0%2e2%2e7/card.png',
    '/assets/token=fixture-secret/card.png', '/assets/Bearer fixture-secret/card.png',
    'data:image/png;base64,fixture-secret', 'https://probe.example.invalid/private/card.png',
  ];
  for (const input of inputs) {
    const resource = cardSpriteResource(input)!;
    assert.match(resource, /^asset-[a-f0-9]{16}$/);
    assert.equal(resource, cardSpriteResource(input), '相同资源在同一运行和不同页面中可关联');
    assert.doesNotMatch(resource, /example|192\.0\.2|2001:db8|secret|Bearer|base64/);
  }
  assert.equal(cardSpriteResource('/assets/card.png?token=fixture-secret#private'), cardSpriteResource('/assets/card.png'));
  assert.notEqual(cardSpriteResource('/assets/card-a.png'), cardSpriteResource('/assets/card-b.png'));
  assert.equal(cardSpriteResource(null), null);
});

test('实际注入、接收及冻结／最终附件持久化边界不输出原图片路径', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-card-privacy-'));
  try {
    let script = '';
    let receive: (source: unknown, entry: unknown) => void;
    const image = { src: '', currentSrc: '', complete: true, naturalWidth: 1122, naturalHeight: 800 };
    const node = {
      /**
       * 模拟图集中的实际 DOM 图片，其余层不提供额外数据。
       * @param selector - 固定图集选择器。
       */
      querySelector: (selector: string) => selector.includes(' img') ? image : null,
      /** 本回归不包含玩家祖先。 */ closest: () => null,
      /** 返回固定布局，不包含路径。 */ getBoundingClientRect: () => ({ x: 0, y: 0, width: 45, height: 68 }),
      /** 表示容器在视口内。 */ checkVisibility: () => true,
      /** 返回固定的容器类型。 */ getAttribute: () => 'sprite-image-container',
      isConnected: true, offsetWidth: 45,
    };
    /** VM 仅验证同步采样和附件边界，浏览器布局观察由专用浏览器回归负责。 */
    class Observer {
      /** 不触发额外布局或变更。 */ observe(): void {}
      /** 不保存已移除节点。 */ unobserve(): void {}
    }
    const window = {
      /**
       * 模拟 Playwright binding 的异步投递，使用真实的宿主接收函数。
       * @param entry - 未脱敏的浏览器事件。
       */
      __clrnCardSpriteEvent: async (entry: unknown) => receive(null, entry),
    };
    const context = vm.createContext({ window, URL, ResizeObserver: Observer, MutationObserver: Observer,
      location: { href: 'https://assets.example.invalid' }, document: {
        /** 返回唯一图集，模拟真实注入选择器的结果。 */ querySelectorAll: () => [node],
        /** VM 回归不投递原生 load/error。 */ addEventListener: () => {},
      } });
    const page = {
      /**
       * 保存真实的宿主接收边界。
       * @param _name - 固定 binding 名称。
       * @param callback - 实际诊断接收函数。
       */
      exposeBinding: async (_name: string, callback: typeof receive) => { receive = callback; },
      /**
       * 捕获将要交给浏览器的实际脚本。
       * @param value - 注入脚本。
       */
      addInitScript: async (value: string) => { script = value; },
      /**
       * 在相同 VM 中执行真实采样和保存阶段的页面函数。
       * @param callback - 页面读取函数。
       * @param argument - 固定事件名。
       */
      evaluate: async (callback: Function, argument: unknown) => {
        context.argument = argument;
        return vm.runInContext(`(${callback.toString()})(argument)`, context);
      },
      /** 提供固定的公开构建身份。 */ locator: () => ({
        /** 返回完整构建编号。 */ getAttribute: async () => 'a'.repeat(40),
      }),
      /** 返回固定视口。 */ viewportSize: () => ({ width: 375, height: 812 }),
    } as unknown as Page;
    await installCardSpriteDiagnostics(page);
    vm.runInContext(script, context);
    for (const fragment of ['probe.example.invalid', '192.0.2.7', '[2001:db8::7]', 'token=fixture-secret']) {
      image.src = `https://assets.example.invalid/assets/${fragment}/card.png?token=fixture-secret`;
      await sampleCardSprites(page, 'privacy-probe');
    }
    const info = { project: { name: 'vm' }, repeatEachIndex: 0, retry: 0,
      /**
       * 只写本测试自己的临时目录。
       * @param name - 实际附件文件名。
       */ outputPath: (name: string) => path.join(directory, name),
      /** 附件通过磁盘内容核对，不模拟成功返回值。 */ attach: async () => {},
    } as unknown as TestInfo;
    for (const phase of ['frozen', 'final'] as const) {
      await saveCardSpriteDiagnostics(page, info, phase);
      const contents = await readFile(path.join(directory, phase === 'frozen'
        ? 'card-sprite-diagnostics-frozen.json' : 'card-sprite-diagnostics.json'), 'utf8');
      assert.doesNotMatch(contents, /example\.invalid|192\.0\.2\.7|2001:db8|fixture-secret|\/assets\//);
      assert.match(contents, /asset-[a-f0-9]{16}/);
      assert.ok(JSON.parse(contents).entries.length >= 4);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
