/** 使用真实浏览器验证俱乐部分页限宽及游客登录横幅的截图门禁。 */
import { expect, test, type Page } from '@playwright/test';
import { assertGuestClubReady } from '../cases/club/guestReadiness';
import { lockPageWidth } from '../src/support/pageStabilizers';

const loginArtwork = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect width="300" height="80" fill="purple"/></svg>',
)}`;

/**
 * 重建应用的双页轨道和裁切父容器，第二页初始处于选中状态。
 * @param page - 隔离的浏览器页面。
 * @param signedIn - 是否展示已登录俱乐部内容。
 */
async function renderClub(page: Page, signedIn = false): Promise<void> {
  const contents = signedIn
    ? '<button data-testid="create-club">创建俱乐部</button>'
    : `<button data-testid="not-sign-in-container" style="width:375px;height:84px;padding:0;border:0">
        <span data-testid="not-sign-in-image" style="display:block;width:300px;height:80px;margin:auto">
          <img src="${loginArtwork}" style="width:300px;height:80px" />
        </span>
      </button>`;
  await page.setContent(`
    <style>body { margin:0 } button { cursor:pointer }</style>
    <div data-testid="club-tab-screen" style="width:375px;margin:auto;overflow:hidden">
      <button data-testid="club_tab_room">牌局</button>
      <button data-testid="club_tab_my_club">我的俱乐部</button>
      <div style="width:375px;overflow:hidden">
        <div data-testid="page-track" style="display:flex;width:750px;transform:translateX(-375px)">
          <div style="width:375px;flex-shrink:0;height:600px">牌局内容</div>
          <div style="width:375px;flex-shrink:0;height:600px">${contents}</div>
        </div>
      </div>
    </div>
  `);
  await page.getByTestId('club_tab_room').evaluate(
    /**
     * 保留真实点击及浏览器布局，让页签切换到第一张面板。
     * @param element - 牌局按钮。
     */
    element => element.addEventListener('click', /** 将轨道恢复到第一页。 */ () => {
      const track = document.querySelector<HTMLElement>('[data-testid="page-track"]');
      if (track) track.style.transform = 'translateX(0px)';
    }),
  );
  await page.getByTestId('club_tab_my_club').evaluate(
    /**
     * 切换回第二张面板，验证限宽没有破坏后续交互。
     * @param element - 我的俱乐部按钮。
     */
    element => element.addEventListener('click', /** 将轨道平移到第二页。 */ () => {
      const track = document.querySelector<HTMLElement>('[data-testid="page-track"]');
      if (track) track.style.transform = 'translateX(-375px)';
    }),
  );
}

for (const width of [375, 1440]) {
  for (const signedIn of [false, true]) {
    test(`${width} 像素下${signedIn ? '已登录' : '游客'}俱乐部保留第二页内容及页签切换`,
      /**
       * 在真实布局引擎中检查轨道宽度、完整可见性和实际点击。
       * @param fixtures - Playwright 提供的隔离页面。
       */
      async ({ page }) => {
        await page.setViewportSize({ width, height: 812 });
        await renderClub(page, signedIn);
        await lockPageWidth(page, width);
        await expect(page.getByTestId('page-track'), '双页轨道必须保留两页总宽度')
          .toHaveCSS('width', '750px');
        const content = page.getByTestId(signedIn ? 'create-club' : 'not-sign-in-container');
        await expect(content, '第二页的业务内容必须完整可见').toBeInViewport({ ratio: 1 });
        await content.click();
        if (!signedIn) await assertGuestClubReady(page);
        await page.getByTestId('club_tab_room').click();
        await expect(content, '切换到牌局后第二页应离开可见区域').not.toBeInViewport();
        await page.getByTestId('club_tab_my_club').click();
        await expect(content, '切回我的俱乐部后内容应重新完整显示').toBeInViewport({ ratio: 1 });
      },
    );
  }
}

test('游客检查拒绝旧限宽规则造成的祖先裁切',
  /**
   * 即使横幅本身仍有尺寸，也不能把完全被祖先裁掉的内容当成就绪。
   * @param fixtures - Playwright 提供的隔离页面。
   */
  async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await renderClub(page);
    await page.getByTestId('page-track').evaluate(
      /**
       * 重现旧截图逻辑施加的限宽和裁切。
       * @param element - 双页轨道。
       */
      element => { element.style.maxWidth = '375px'; element.style.overflowX = 'hidden'; },
    );
    await expect(assertGuestClubReady(page), '被祖先裁切的横幅必须使截图失败')
      .rejects.toThrow('登录横幅必须完整可见');
  },
);

test('其他页面的登录横幅不能替代俱乐部内容',
  /**
   * 俱乐部只有外壳时，即使其他页面保留了共用横幅也应失败。
   * @param fixtures - Playwright 提供的隔离页面。
   */
  async ({ page }) => {
    await page.setContent(`<div data-testid="club-tab-screen">俱乐部</div>
      <div data-testid="not-sign-in-container">其他页面的登录入口</div>`);
    await expect(assertGuestClubReady(page), '必须检查俱乐部内部的登录横幅')
      .rejects.toThrow('游客俱乐部必须显示唯一登录横幅');
  },
);

test('游客检查拒绝登录横幅图片解码失败',
  /**
   * 保留图片容器尺寸，验证门禁仍检查实际资源而非只看外壳。
   * @param fixtures - Playwright 提供的隔离页面。
   */
  async ({ page }) => {
    await renderClub(page);
    await page.locator('[data-testid="not-sign-in-image"] img').evaluate(
      /**
       * 换成不可解码的数据，避免依赖外部网络失败。
       * @param image - 登录横幅内部图片。
       */
      image => { image.setAttribute('src', 'data:image/png;base64,AA=='); },
    );
    await expect(assertGuestClubReady(page), '图片加载失败必须阻止接受截图')
      .rejects.toThrow('登录引导图片必须成功解码');
  },
);

test('桌面子像素取整可通过，但一像素的真实裁切必须失败',
  /**
   * 同时验证精度边界，不能为兼容桌面缩放而放过可见内容缺失。
   * @param fixtures - Playwright 提供的隔离页面。
   */
  async ({ page }) => {
    await renderClub(page);
    const club = page.getByTestId('club-tab-screen');
    await club.evaluate(
      /**
       * 模拟缩放后不足半个 CSS 像素的布局取整。
       * @param element - 俱乐部裁切容器。
       */
      element => { element.style.width = '374.75px'; },
    );
    await assertGuestClubReady(page);
    await club.evaluate(
      /**
       * 真正裁掉一个 CSS 像素，必须被门禁发现。
       * @param element - 俱乐部裁切容器。
       */
      element => { element.style.width = '374px'; },
    );
    await expect(assertGuestClubReady(page), '精度容差不能掩盖一像素裁切')
      .rejects.toThrow('登录横幅必须完整可见');
  },
);

test('忽略非活动页签保留的横幅，但拒绝活动页中的重复横幅',
  /**
   * 复现两个页签均挂载后的导航结构，检查唯一性以活动页为准。
   * @param fixtures - Playwright 提供的隔离页面。
   */
  async ({ page }) => {
    await renderClub(page);
    await page.getByTestId('page-track').evaluate(
      /**
       * 在第一页保留同一登录组件，并标记其为非活动页。
       * @param track - 横向分页轨道。
       */
      track => {
        const firstPage = track.firstElementChild;
        const banner = track.querySelector('[data-testid="not-sign-in-container"]');
        if (!firstPage || !banner) throw new Error('分页测试结构不完整');
        firstPage.setAttribute('aria-hidden', 'true');
        firstPage.replaceChildren(banner.cloneNode(true));
      },
    );
    await assertGuestClubReady(page);
    await page.getByTestId('page-track').evaluate(
      /**
       * 移除非活动标记后，两个横幅不得被静默选取其中一个。
       * @param track - 横向分页轨道。
       */
      track => track.firstElementChild?.removeAttribute('aria-hidden'),
    );
    await expect(assertGuestClubReady(page), '活动页面的重复横幅必须报错')
      .rejects.toThrow('游客俱乐部必须显示唯一登录横幅');
  },
);
