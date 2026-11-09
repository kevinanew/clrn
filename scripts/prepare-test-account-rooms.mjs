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
  return readResponse(response, operation);
}

/** 校验真实 HTTP 状态并解析业务响应。
 * @param response - 实际响应。
 * @param operation - 固定操作标识。 */
async function readResponse(response, operation) {
  if (!response.ok) throw requestFailure(operation, 'http-error', response.status);
  const result = await response.json().catch(/** 将 JSON 解析或正文读取错误转换为保留真实状态的安全诊断。
 * @param error - 当前操作抛出的错误。 */ error => {
    throw requestFailure(operation, error instanceof SyntaxError ? 'invalid-json' : 'body-read-failed', response.status);
  });
  if (!successfulResult(result)) throw requestFailure(operation, 'business-rejected', response.status);
  return { result: result.result, status: response.status };
}

/**
 * 仅识别本账号、本屋内由测试命名且从未开始、没有入座者的非官方房间。
 * @param room - 刚从服务端读取的房间详情。
 * @param session - 当前独占账号会话。
 * @param houseId - 已核对归属的私人房屋编号。
 * @param summary - 是否为列表摘要；详情必须明确包含官方字段。
 */
function recoverable(room, session, houseId, summary) {
  if (!room) return false;
  return roomIdentityMatches(room, session, houseId) && idleTestRoom(room, summary);
}

/** 核对房间编号、创建者及私人房屋归属。
 * @param room - 服务端房间详情。
 * @param session - 当前账号会话。
 * @param houseId - 已核对的房屋编号。 */
function roomIdentityMatches(room, session, houseId) {
  if (!identifier.test(room.room_id)) return false;
  return Object.entries({ creator_id: session.userId, building_id: houseId, building_type: 'house' }).every(
    /** 逐字段核对房间归属。
     * @param entry - 预期字段和值。 */ ([key, value]) => room[key] === value);
}

/** 列表允许官方标志缺省，详情必须明确为非官方。
 * @param room - 房间详情或列表摘要。
 * @param summary - 是否为列表摘要。 */
function nonOfficial(room, summary) { return room.is_official === false || missingSummaryFlag(room, summary); }

/** 仅列表摘要允许缺失官方标志。
 * @param room - 房间列表摘要。
 * @param summary - 是否为列表摘要。 */
function missingSummaryFlag(room, summary) { return summary && room.is_official === undefined; }

/** 只允许测试命名、未开始计时且无人入座的房间。
 * @param room - 房间详情或列表摘要。
 * @param summary - 是否为列表摘要。 */
function idleTestRoom(room, summary) {
  if (!nonOfficial(room, summary)) return false;
  const idle = { room_status: 'opening', timer_status: 'wait_for_timing', timing_at: null, seat_occupied: 0 };
  return Object.entries(idle).every(/** 核对未开局状态。
   * @param entry - 状态字段和值。 */ ([key, value]) => room[key] === value) && testRoomName(room.room_name);
}

/** 识别已登记的两类测试房间名。
 * @param name - 房间名称。 */
function testRoomName(name) { return name === 'TestRoom' || /^E2E私局[0-9a-z]+$/.test(name); }

/** 拒绝无效的准备会话，保留原有错误。
 * @param session - 当前账号会话。 */
function validateSession(session) {
  if (!validSessionUser(session)) throw new Error('准备测试私人房间缺少有效账号会话');
  if (!validAuthorization(session.authorization)) throw new Error('准备测试私人房间缺少有效账号会话');
}

/** 核对 Bearer 会话头。
 * @param authorization - 当前账号认证头。 */
function validAuthorization(authorization) { return typeof authorization === 'string' && /^Bearer \S+$/i.test(authorization); }

/** 核对房屋属于当前账号。
 * @param house - 房屋响应。
 * @param session - 当前账号会话。 */
function validHouse(house, session) {
  if (!house) return false;
  return identifier.test(house.house_id) && house.user_id === session.userId;
}

/**
 * 在账号锁内恢复空闲测试房间；未知数据只报错，不删除，普通用例仍由自己的收尾负责清理。
 * @param session - 金币准备完成后返回的已验证账号会话。
 */
export async function prepareTestAccountRooms(session) {
  validateSession(session);
  const { result: house, status: houseStatus } = await request(session, `/v10/house/user/${session.userId}`, 'PUT', undefined, 'prepare-room-house');
  if (!validHouse(house, session)) {
    throw requestFailure('prepare-room-house', 'invalid-response', houseStatus);
  }
  await recoverHouseRoom(session, house.house_id);
}

/** 读取列表后仅恢复单个已识别的空闲测试房间。
 * @param session - 当前账号会话。
 * @param houseId - 已核对的房屋编号。 */
async function recoverHouseRoom(session, houseId) {
  const body = { building_ids: [houseId] };
  const { result: rooms, status: listStatus } = await request(session, '/v2/building/rooms', 'PUT', body, 'prepare-room-list');
  validateRoomList(rooms, session, houseId, listStatus);
  if (rooms.length === 0) return;
  await deleteIdleRoom(rooms[0].room_id, session, houseId, body);
}

/** 拒绝非数组或未知的房间列表。
 * @param rooms - 服务端列表。
 * @param session - 当前账号会话。
 * @param houseId - 房屋编号。
 * @param status - 真实响应状态。 */
function validateRoomList(rooms, session, houseId, status) {
  if (!Array.isArray(rooms)) throw requestFailure('prepare-room-list', 'invalid-response', status);
  if (!validRoomList(rooms, session, houseId)) throw requestFailure('prepare-room-list', 'invalid-response', status);
}

/** 空列表无需清理，非空列表必须恰有一个可恢复房间。
 * @param rooms - 已确认的数组。
 * @param session - 当前账号会话。
 * @param houseId - 房屋编号。 */
function validRoomList(rooms, session, houseId) {
  if (rooms.length === 0) return true;
  return rooms.length === 1 && recoverable(rooms[0], session, houseId, true);
}

/** 重新核对详情后删除，并通过真实列表验证清理结果。
 * @param roomId - 列表中的房间编号。
 * @param session - 当前账号会话。
 * @param houseId - 房屋编号。
 * @param body - 列表请求正文。 */
async function deleteIdleRoom(roomId, session, houseId, body) {
  const { result: current, status: roomStatus } = await request(session, `/v1/room/${roomId}`, 'GET', undefined, 'prepare-room-inspect');
  if (!validCurrentRoom(current, roomId, session, houseId)) {
    throw requestFailure('prepare-room-inspect', 'invalid-response', roomStatus);
  }
  await request(session, `/v1/room/${roomId}`, 'DELETE', undefined, 'prepare-room-delete');
  const { result: remaining, status: verifyStatus } = await request(session, '/v2/building/rooms', 'PUT', body, 'prepare-room-verify');
  if (!emptyRoomList(remaining)) throw requestFailure('prepare-room-verify', 'invalid-response', verifyStatus);
  console.error(`已恢复本账号的空闲测试房间：${roomId}`);
}

/** 详情编号与列表一致且仍可安全恢复。
 * @param current - 最新详情。
 * @param roomId - 列表房间编号。
 * @param session - 当前账号会话。
 * @param houseId - 房屋编号。 */
function validCurrentRoom(current, roomId, session, houseId) {
  return current?.room_id === roomId && recoverable(current, session, houseId);
}

/** 验证清理后的列表确实为空。
 * @param rooms - 最新房间列表。 */
function emptyRoomList(rooms) { return Array.isArray(rooms) && rooms.length === 0; }

/** 安全读取会话身份。
 * @param session - 当前会话。 */
function validSessionUser(session) { return identifier.test(session?.userId); }

/** 安全读取业务成功字段。
 * @param result - 解析后的业务响应。 */
function successfulResult(result) { return result?.ok === true; }
