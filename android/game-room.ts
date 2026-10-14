import { request, expect } from '@playwright/test';
import type { AndroidDevice } from 'playwright';
import type { Mitmproxy } from '../e2e/helpers/mitmproxy-client';
import { ensureRoomBalance, type Account, type RoomSession } from '../visual/cases/_shared/room';
import { dismissKeyboard } from './keyboard';
import { tap, returnToTabs } from './navigation';
import { waitAbsent } from './native-state';

/**
 * 从认证的本机控制接口取得本轮真实会话；不将令牌写入日志或报告。
 * @param proxy - 本轮独占代理。
 */
export async function gameSession(proxy: Mitmproxy): Promise<{ account: Account | null; room: RoomSession | null }> {
  return proxy.command('android/session');
}

/**
 * 共用 Web 的余额验证，通过原生表单创建本例私人房，立即登记以便失败时清理。
 * @param device - 专用模拟器连接。
 * @param proxy - 本轮独占代理。
 * @param game - 本轮玩法。
 * @param onCreated - 新房间登记回调。
 */
export async function createGameRoom(device: AndroidDevice, proxy: Mitmproxy,
  game: 'texas-holdem' | 'zhajinhua', onCreated: (room: RoomSession) => void): Promise<RoomSession> {
  const { account } = await gameSession(proxy);
  if (!account || account.username !== process.env.VISUAL_USERNAME) throw new Error('建房必须使用本轮真实登录的测试账号。');
  const api = await request.newContext();
  try { await ensureRoomBalance(api, account); }
  finally { await api.dispose(); }
  await returnToTabs(device);
  await tap(device, 'hall-tab');
  await tap(device, 'personal-house-create');
  await tap(device, `game-type-button-${game === 'texas-holdem' ? 'texas_react_native' : game}`);
  await device.wait({ res: 'room-name-input' });
  await device.fill({ res: 'room-name-input' }, 'TestRoom');
  await dismissKeyboard(device);
  await tap(device, 'creat-room-button');
  let room: RoomSession | null = null;
  await expect(async () => {
    room = (await gameSession(proxy)).room;
    expect(room, '真实建房接口必须返回本轮新建的房间').not.toBeNull();
  }).toPass({ timeout: 60_000, intervals: [500] });
  onCreated(room!);
  await device.wait({ res: 'run-game-view' }, { timeout: 60_000 });
  await waitAbsent(device, { res: 'game-splash-screen-bg' });
  await device.wait({ res: 'menu-button' }, { timeout: 60_000 });
  return room!;
}
