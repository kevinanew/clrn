import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildScenarios } from './scenarios';
import { visualBaseUrl } from './target';
import { renderSnapshotGallery } from './snapshot-gallery-page';

// 与测试使用同一份场景清单，历史废弃截图不冒充当前覆盖。
const scenarios = buildScenarios().flatMap(scenario =>
  scenario.snapshotStates?.map(state => ({
    ...scenario,
    label: `${scenario.label}_${state}`,
    pageLabel: `${scenario.pageLabel}_${state}`,
  })) ?? [scenario]);
const directory = path.join(__dirname, 'snapshots');
// Playwright 对 snapshot 参数中的下划线进行文件名清洗。
const filename = (label: string) => `${label.replace(/_/g, '-')}.png`;
const snapshotFile = (scenario: (typeof scenarios)[number]) =>
  `../cases/${scenario.group}/snapshots/${filename(scenario.label)}`;
const missing = scenarios.filter(scenario => !existsSync(path.join(directory, snapshotFile(scenario))));
if (missing.length) {
  throw new Error(`缺少 ${missing.length} 张基准图，请先完成 reference：\n${missing.map(s => s.label).join('\n')}`);
}
const pages = scenarios.map(scenario => {
  const file = snapshotFile(scenario);
  return {
    label: scenario.label,
    page: scenario.pageLabel,
    group: scenario.group,
    locale: scenario.locale,
    viewport: scenario.viewport,
    signedIn: scenario.signIn,
    navigation: [scenario.tabTestId, ...scenario.navClickTestIds].filter(Boolean),
    readySelector: scenario.visualReadySelector,
    fixedTexts: scenario.fixedTexts,
    hiddenSelectors: scenario.hideSelectors,
    file,
    sha256: createHash('sha256').update(readFileSync(path.join(directory, file))).digest('hex'),
  };
});
writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
  baseUrl: visualBaseUrl,
  scope: process.env.VISUAL_SCOPE || 'full',
  note: 'Linux 视觉基准清单。德州和拼三张场景会真实建房、进入牌桌并解散本次房间；其余页面使用固定文本与视觉接口 fixtures。生成清单不会更新或批准截图。',
  count: pages.length,
  pages,
}, null, 2) + '\n');
writeFileSync(path.join(directory, 'index.html'), renderSnapshotGallery(pages));
console.log(`已生成 ${pages.length} 张截图的索引：snapshots/index.html`);
