import { requestFailure, requestFailureReason } from './request-failure.cjs';

const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 通过固定 staging 入口读取或清理测试房间，错误只包含阶段，不包含会话或响应正文。
 * @param session - 已核对身份的当前独占账号会话。
 * @param path - 接口路径。
 * @param method - 请求方法。
 * @param body - 可选请求正文。
 * @param operation - 固定的非敏感操作标识。
 */
async function request(session, path, method, body, operation) {
  let response;
  try {
    response = await fetch(`https://api.shafayouxi.org${path}`, {
      method, headers: { Authorization: session.authorization, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
  } catch (error) { throw requestFailure(operation, requestFailureReason(error)); }
  if (!response.ok) throw requestFailure(operation, 'http-error', response.status);
  const result = await response.json().catch(error => {
    throw requestFailure(operation, error instanceof SyntaxError ? 'invalid-json' : 'body-read-failed', response.status);
  });
  if (result?.ok !== true) throw requestFailure(operation, 'business-rejected', response.status);
  return { result: result.result, status: response.status };
}

/**
 * 仅识别本账号、本屋内由测试命名且从未开始、没有入座者的非官方房间。
 * @param room - 刚从服务端读取的房间详情。
 * @param session - 当前独占账号会话。
 * @param houseId - 已核对归属的私人房屋编号。
 * @param summary - 列表摘要不返回官方标志，必须随后以详情核对该字段。
 */
function recoverable(room, session, houseId, summary = false) {
  return room && identifier.test(room.room_id) && room.creator_id === session.userId
    && room.building_id === houseId && room.building_type === 'house'
    && (room.is_official === false || (summary && room.is_official === undefined)) && room.room_status === 'opening'
    && room.timer_status === 'wait_for_timing' && room.timing_at === null && room.seat_occupied === 0
    && (room.room_name === 'TestRoom' || /^E2E私局[0-9a-z]+$/.test(room.room_name));
}

/**
 * 在账号锁内恢复空闲测试房间；未知数据只报错，不删除，普通用例仍由自己的收尾负责清理。
 * @param session - 金币准备完成后返回的已验证账号会话。
 */
export async function prepareTestAccountRooms(session) {
  if (!identifier.test(session?.userId) || typeof session.authorization !== 'string'
    || !/^Bearer \S+$/i.test(session.authorization)) throw new Error('准备测试私人房间缺少有效账号会话');
  const { result: house, status: houseStatus } = await request(session, `/v10/house/user/${session.userId}`, 'PUT', undefined, 'prepare-room-house');
  if (!house || !identifier.test(house.house_id) || house.user_id !== session.userId) {
    throw requestFailure('prepare-room-house', 'invalid-response', houseStatus);
  }
  const body = { building_ids: [house.house_id] };
  const { result: rooms, status: listStatus } = await request(session, '/v2/building/rooms', 'PUT', body, 'prepare-room-list');
  if (!Array.isArray(rooms)) throw requestFailure('prepare-room-list', 'invalid-response', listStatus);
  if (rooms.length === 0) return;
  if (rooms.length !== 1 || !recoverable(rooms[0], session, house.house_id, true)) {
    throw requestFailure('prepare-room-list', 'invalid-response', listStatus);
  }
  const roomId = rooms[0].room_id;
  const { result: current, status: roomStatus } = await request(session, `/v1/room/${roomId}`, 'GET', undefined, 'prepare-room-inspect');
  if (current?.room_id !== roomId || !recoverable(current, session, house.house_id)) {
    throw requestFailure('prepare-room-inspect', 'invalid-response', roomStatus);
  }
  await request(session, `/v1/room/${roomId}`, 'DELETE', undefined, 'prepare-room-delete');
  const { result: remaining, status: verifyStatus } = await request(session, '/v2/building/rooms', 'PUT', body, 'prepare-room-verify');
  if (!Array.isArray(remaining) || remaining.length !== 0) throw requestFailure('prepare-room-verify', 'invalid-response', verifyStatus);
  console.error(`已恢复本账号的空闲测试房间：${roomId}`);
}
