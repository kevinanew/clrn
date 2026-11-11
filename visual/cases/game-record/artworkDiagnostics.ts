import { test, type Page } from '@playwright/test';

/**
 * 结算截图失败后只读采集头像绘制状态，区分加载、回退及祖先裁切问题。
 * @param page - 原截图页面。
 */
export async function attachSettlementArtworkDiagnostics(page: Page): Promise<void> {
  try {
    const body = await page.evaluate(/** 不保存图片地址、玩家标识或页面文字。 */ () => {
      /**
       * 将图片来源归类，不输出可能含有账号信息的地址。
       * @param source - 当前图片地址。
       */
      const sourceKind = (source: string) => {
        if (!source) return 'none';
        try {
          const url = new URL(source, location.href);
          if (url.protocol === 'data:') return 'data';
          return url.origin === location.origin ? 'same-origin' : 'external';
        } catch { return 'invalid'; }
      };
      return Array.from(document.querySelectorAll('[data-testid="game-settlement-list"] [data-testid="user_avatar_image"]'))
        .slice(0, 8).map(/** 保留透明 img 与背景绘制层的独立状态。
         * @param avatar - 当前头像。 */ avatar => {
          const ancestors = [];
          for (let node: Element | null = avatar; node && ancestors.length < 10; node = node.parentElement) {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            ancestors.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height,
              opacity: style.opacity, visibility: style.visibility, display: style.display,
              overflowX: style.overflowX, overflowY: style.overflowY, zIndex: style.zIndex });
          }
          return { visible: avatar.checkVisibility(), ancestors, images: Array.from(avatar.querySelectorAll('img')).map(
            /** 透明 img 仍记录其解码状态，不采用普通可见图片过滤。
             * @param img - React Native 图片节点。 */ img => ({
              source: sourceKind(img.currentSrc || img.src), complete: img.complete,
              naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
              opacity: getComputedStyle(img).opacity,
            })), backgrounds: Array.from(avatar.children).map(
            /** 只记录绘制层是否存在背景及滤镜，不输出原始 CSS 地址。
             * @param node - 头像的直接绘制层。 */ node => {
              const style = getComputedStyle(node);
              return { hasBackground: style.backgroundImage !== 'none', opacity: style.opacity,
                hasFilter: style.filter !== 'none', zIndex: style.zIndex };
            }) };
        });
    });
    await test.info().attach('settlement-artwork-diagnostics', {
      body: JSON.stringify(body), contentType: 'application/json',
    });
  } catch { /* 可选诊断失败必须保留原始截图异常与测试结果。 */ }
}
