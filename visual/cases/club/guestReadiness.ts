/** 截图前核实游客俱乐部登录横幅，拒绝缺图、重复控件和祖先容器裁切。 */
import { expect, type Locator, type Page } from '@playwright/test';

/**
 * 根据浏览器计算的交集检查祖先裁切，容许缩放布局产生的半个 CSS 像素取整。
 * @param element - 唯一待检查的横幅或图片。
 * @param message - 失败时说明缺失内容的中文提示。
 */
async function assertFullyVisible(element: Locator, message: string): Promise<void> {
  await expect(element, message).toBeVisible();
  await expect.poll(
    /** 重新读取布局，等待页签转场结束后的真实可见区域。 */
    () => element.evaluate(
      /**
       * IntersectionObserver 同时考虑视口和所有祖先的裁切。
       * @param target - 实际页面节点。
       */
      target => new Promise<boolean>(
        /**
         * 只采集一次交集后释放观察器，避免跨测试残留。
         * @param resolve - 返回本次可见性判断。
         */
        resolve => {
          const observer = new IntersectionObserver(
            /**
             * 检查每条边的缺失距离，而非放宽整张图片的可见比例。
             * @param entries - 浏览器计算的交集结果。
             */
            entries => {
              observer.disconnect();
              const { boundingClientRect: bounds, intersectionRect: visible } = entries[0];
              resolve(visible.width > 0 && visible.height > 0
                && visible.left - bounds.left <= 0.5 && bounds.right - visible.right <= 0.5
                && visible.top - bounds.top <= 0.5 && bounds.bottom - visible.bottom <= 0.5);
            },
          );
          observer.observe(target);
        },
      ),
    ),
    { message },
  ).toBe(true);
}

/**
 * 检查当前俱乐部页面的真实登录引导及其图片，不能用外壳挂载代替内容就绪。
 * @param page - 已完成导航和截图稳定化的页面。
 */
export async function assertGuestClubReady(page: Page): Promise<void> {
  const club = page.locator('[data-testid="club-tab-screen"]:visible');
  await expect(club, '游客俱乐部必须只有一个可见页面').toHaveCount(1);
  // 两个页签都会保留已挂载的横幅；非活动页虽有尺寸，仍被 aria-hidden 排除。
  const banner = club.locator(
    '[data-testid="not-sign-in-container"]:visible:not([aria-hidden="true"], [aria-hidden="true"] *)',
  );
  await expect(banner, '游客俱乐部必须显示唯一登录横幅').toHaveCount(1);
  await assertFullyVisible(banner, '登录横幅必须完整可见，不能被分页轨道或视口裁切');
  const artwork = banner.getByTestId('not-sign-in-image');
  await expect(artwork, '登录引导图片必须唯一').toHaveCount(1);
  await assertFullyVisible(artwork, '登录引导图片必须完整可见');
  await expect.poll(
    /** 读取实际图片的解码结果，加载失败时 complete 同样为真，必须同时核对尺寸。 */
    () => artwork.evaluate(
      /**
       * React Native Web 的图片通常以背景图容器包裹真实 img，兼容直接图片节点。
       * @param element - 登录引导图片节点。
       */
      (element) => {
        const image = element instanceof HTMLImageElement ? element : element.querySelector('img');
        return image !== null && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
      },
    ),
    { message: '登录引导图片必须成功解码，不能保存缺图基准' },
  ).toBe(true);
}
