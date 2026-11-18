import type { Locator } from '@playwright/test';
import { expect } from './proxy';

const views = {
  actions: { row: 'texas-settlement-item', nickname: 'texasPlayerPositionIcon:playerName' },
  settlement: { row: 'GameSettlementItemTwo_Container', nickname: 'GameSettlementItemTwo_Nickname' },
};

// data.py 的私人房 replay 按座位顺序提供这两组 showdown 手牌。
const privateHands = [
  { nickname: 'Visual Player', cards: ['as', 'ad'] },
  { nickname: 'Opponent', cards: ['kh', 'ks'] },
];

/**
 * 等待私人房的两名玩家、手牌顺序及实际绘制的牌面就绪。
 * @param panel - 当前可见的动作或结算容器。
 * @param tab - 确定行和昵称标记的回放标签。
 */
export async function waitForLegacyPrivateHands(panel: Locator, tab: keyof typeof views): Promise<void> {
  const { row, nickname } = views[tab];
  const players = panel.getByTestId(row);
  await expect.poll(/** 每次从当前 DOM 同时读取两个玩家的昵称和牌槽。 */ () => players.evaluateAll(
    /** 读取实际牌面图层及对应的加载状态。
     * @param rows - 按座位顺序排列的结算行。
     * @param nicknameId - 当前布局的昵称标记。
     */ (rows, nicknameId) => {
      /**
       * 检查实际绘制层的尺寸及其在截图视口中的位置。
       * @param artwork - 绘制牌面背景的节点。
       */
      const fitsViewport = (artwork: Element) => {
        const box = artwork.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0
          && box.right <= innerWidth && box.bottom <= innerHeight;
      };
      /**
       * 验证可见背景与浏览器已加载的牌面一致。
       * @param slot - 当前手牌槽。
       */
      const readCard = (slot: Element) => {
        // React Native Web 用背景绘牌，旁边的透明 img 提供图片语义与加载状态。
        const image = slot.querySelector('img');
        if (!image) return 'missing image';
        const artwork = image.previousElementSibling;
        if (!artwork?.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return 'missing artwork';
        const source = new URL(image.src, document.baseURI);
        const card = source.pathname.match(/\/poker_([2-9tjqka][cdhs])_simple[@.]/)?.[1];
        if (!card) return 'unrecognized face';
        if (getComputedStyle(artwork).backgroundImage !== `url("${source.href}")`) return `incorrect background for ${card}`;
        if (!image.complete || Math.min(image.naturalWidth, image.naturalHeight) === 0) return `unloaded ${card}`;
        return fitsViewport(artwork) ? card : `outside viewport ${card}`;
      };
      return rows.map(/** 读取单个座位的展示数据。
       * @param player - 当前玩家所在的结算行。
       */ player => ({
        nickname: player.querySelector(`[data-testid="${nicknameId}"]`)?.textContent,
        cards: Array.from(player.querySelectorAll('[data-testid^="hole-card-"], '
          + '[data-testid^="masked-hole-card-"], [data-testid^="displayed-hole-card-"]'), readCard),
      }));
    }, nickname), { message: `旧版私人房 ${tab} 须显示完整手牌和固定昵称`, timeout: 15_000 }).toEqual(privateHands);
}
