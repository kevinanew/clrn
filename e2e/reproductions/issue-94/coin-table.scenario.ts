/** 通过真实初始化、登录和金币桌操作收集修复前证据，不启用视觉回放。 */
import { test, expect } from '@playwright/test';
import { openHall, prepareContext } from '../../cases/_shared/page';
import { signIn } from '../../cases/_shared/auth';
import { clickAfterSignInNotices } from '../../cases/_shared/sign-in-notices';
import { writeFile } from 'node:fs/promises';

test('金币桌匹配及入座前置检查（需要不同真实出口）', async ({ page, context, browser }, information) => {
  const username = process.env.ISSUE94_PEER_USERNAME;
  const password = process.env.ISSUE94_PEER_PASSWORD;
  if (!username || !password) throw new Error('金币匹配检查必须通过 run.mjs --coin-baseline 取得两个独占账号');
  await prepareContext(context);
  await openHall(page);
  await signIn(page);
  await clickAfterSignInNotices(page, 'hall-tab');
  await page.screenshot({ path: information.outputPath('01-signed-in.png') });
  const room = page.getByTestId('match-game-item-texas_holdem-tourists');
  await expect(room).toBeVisible();
  const peerProxy = process.env.ISSUE94_PEER_PROXY_URL;
  const peerContext = await browser.newContext({ baseURL: page.url(),
    ...(peerProxy ? { proxy: { server: peerProxy, bypass: '127.0.0.1,localhost' } } : {}) });
  const peer = await peerContext.newPage();
  let peerSignedIn = false;
  try {
    await prepareContext(peerContext);
    await openHall(peer);
    await signIn(peer, { username, password });
    peerSignedIn = true;
    await clickAfterSignInNotices(peer, 'hall-tab');
    const response = await page.request.get('https://api.shafayouxi.org/public/v1/hall_matching/texas_holdem/halls');
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.ok).toBe(true);
    const hall = body.result.halls.find((item: { hall_type: string }) => item.hall_type === 'tourists');
    await writeFile(information.outputPath('matching-prerequisites.json'), JSON.stringify({
      checkIpAddress: hall.check_ip_address, checkGpsCoordinate: hall.check_gps_coordinate,
      roomSettings: hall.room_settings, outcome: 'matching-not-yet-confirmed',
      backendDeployment: 'not-verified',
    }, null, 2));
    await response.dispose();
    await room.click();
    await peer.getByTestId('match-game-item-texas_holdem-tourists').click();
    await expect(page.getByTestId('run-game-view')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('texas-holdem-self-seated-marker')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: information.outputPath('02-table.png') });
  } finally {
    await page.screenshot({ path: information.outputPath('03-matching-outcome.png') });
    for (const current of [page, ...(peerSignedIn ? [peer] : [])]) {
      const cancel = current.getByTestId('cancel-match-button');
      if (await cancel.isVisible()) await cancel.click();
    }
    await peerContext.close();
  }
});
