/** 维护 100 个 Web 专用账号的稳定分配和凭据校验，与本机账号隔离。 */
import { readFileSync } from 'node:fs';

// 仅维护本仓库的 Web 账号；凭据由 CLRN_CI_TEST_ACCOUNTS_V3 Secret 单独维护。
export const ciAccounts = JSON.parse(readFileSync(new URL('./ci-test-accounts.json', import.meta.url), 'utf8')).accounts;
if (!Array.isArray(ciAccounts) || ciAccounts.length !== 100
  || ciAccounts.some(/** 判断是否存在满足以下条件的条目：`typeof name !== 'string' || !/^[a-z0-9]{6,30}$/.test(name)`。
 * @param name - 当前操作使用的 name。 */ name => typeof name !== 'string' || !/^[a-z0-9]{6,30}$/.test(name))
  || new Set(ciAccounts).size !== 100) {
  throw new Error('Web CI 账号清单必须包含 100 个不同账号');
}

/**
 * 按运行 ID 轮转账号槽位；账号级 GitHub concurrency 才负责跨 runner 互斥。
 * 同一次重跑复用相同槽位；不同任务若选到同一账号会排队，不会重复登录。
 * @param runId - GitHub Actions 运行 ID，使用字符串以免大整数丢失精度。
 * @param offset - 本轮任务相对起始槽位的偏移。
 * @returns 本任务使用的公开账号名。
 */
export function allocateCiAccount(runId, offset = 0) {
  if (!validAllocation(runId, offset)) {
    throw new Error('CI 账号分配需要有效运行 ID 和账号槽位偏移。');
  }
  return ciAccounts[Number((BigInt(runId) + BigInt(offset)) % BigInt(ciAccounts.length))];
}

/**
 * 为视觉套件与语言组合分配不同账号，避免全量九个任务相互作废会话。
 * @param runId - 当前 GitHub Actions 运行 ID。
 * @param suite - all、app、texas 或 zhajinhua。
 * @param full - 是否覆盖全部三种语言。
 * @returns 可直接用于 GitHub Actions include 矩阵的任务配置。
 */
export function visualAccountMatrix(runId, suite = 'all', full = false) {
  return buildVisualMatrix(runId, suite, full);
}

/** 按固定槽位顺序构建各套件语言矩阵。
 * @param runId - 当前运行编号。
 * @param suite - 需要执行的套件。
 * @param full - 是否执行全部语言。 */
function buildVisualMatrix(runId, suite, full) {
  // 保留账号槽位顺序；只将耗时较长的牌桌任务提前创建。
  const suites = ['app', 'texas', 'zhajinhua'];
  const executionOrder = ['texas', 'zhajinhua', ...suites.filter(/** 仅保留满足以下条件的条目：`item !== 'texas' && item !== 'zhajinhua'`。
 * @param item - 当前遍历的条目。 */ item => item !== 'texas' && item !== 'zhajinhua')];
  validateSuite(suite, suites, '视觉');
  const locales = visualLocales(full);
  return { include: executionOrder.filter(/** 仅保留满足以下条件的条目：`suite === 'all' || item === suite`。
 * @param item - 当前遍历的条目。 */ item => suite === 'all' || item === suite).flatMap(/** 为当前套件的各语言分配固定槽位的 CI 账号。
 * @param item - 当前遍历的条目。 */ item =>
    locales.map(/** 将当前条目映射为`{ suite: item, locale, account: allocateCiAccount(runId, suites.indexOf(item) * 3 + index) }`。
 * @param locale - 当前测试使用的语言。
 * @param index - 当前条目在集合中的位置。 */ (locale, index) => ({ suite: item, locale,
      account: allocateCiAccount(runId, suites.indexOf(item) * 3 + index) }))) };
}

/**
 * 动画使用 12–18 号槽位，与全量静态视觉及三组功能回归互不冲突。
 * @param runId - 当前 GitHub Actions 运行 ID。
 * @param suite - all、app、texas 或 zhajinhua，筛选时保留原账号槽位。
 * @returns 七个动画分片的独占账号矩阵。
 */
export function animationAccountMatrix(runId, suite = 'all') {
  const suites = ['app', 'texas', 'zhajinhua'];
  validateSuite(suite, suites, '动画');
  const parts = {
    app: ['application', 'ui'],
    texas: ['table', 'gameplay', 'social'],
    zhajinhua: ['panels', 'gameplay'],
  };
  let offset = 12;
  return { include: suites.flatMap(/** 展开当前条目对应的`parts[item].map(part => ({ suite: item, part, account: allocateCiAccount(runId, offset++), }))`。
 * @param item - 当前遍历的条目。 */ item => parts[item].map(/** 将当前条目映射为`{ suite: item, part, account: allocateCiAccount(runId, offset++), }`。
 * @param part - 当前操作使用的 part。 */ part => ({
    suite: item, part, account: allocateCiAccount(runId, offset++),
  }))).filter(/** 仅保留满足以下条件的条目：`suite === 'all' || item.suite === suite`。
 * @param item - 当前遍历的条目。 */ item => suite === 'all' || item.suite === suite) };
}

/**
 * 从 Secret 中读取指定槽位的凭据，校验完整账号池并隐藏所有解析细节。
 * @param serialized - GitHub Actions Secret 中的账号池 JSON。
 * @param username - 调度阶段选出的公开账号名，必须属于 CI 专用清单。
 * @returns 指定 CI 账号的用户名和密码。
 */
export function ciAccountCredentials(serialized, username) {
  let pool;
  try { pool = JSON.parse(serialized); } catch { throw new Error('CLRN_CI_TEST_ACCOUNTS_V3 Secret 缺失或不是有效 JSON。'); }
  validatePoolSize(pool);
  const seen = validatePoolAccounts(pool.accounts);
  validatePoolSelection(seen, username);
  const selected = pool.accounts.find(/** 查找满足以下条件的首个条目：`account.username === username`。
 * @param account - 当前操作使用的 account。 */ account => account.username === username);
  if (!selected) throw new Error('所选账号不属于 CI 专用池。');
  return { username: selected.username, password: selected.password };
}

/** 核对运行编号为非空数字字符串。
 * @param runId - GitHub 运行编号。 */
function validRunId(runId) {
  if (typeof runId !== 'string') return false;
  return Boolean(runId) && !/\D/.test(runId);
}

/** 核对偏移在账号池内。
 * @param offset - 槽位偏移。 */
function validOffset(offset) {
  if (!Number.isSafeInteger(offset)) return false;
  return offset >= 0 && offset < ciAccounts.length;
}

/** 拒绝不支持的矩阵套件。
 * @param suite - 用户选项。
 * @param suites - 支持的套件。
 * @param label - 错误中的套件类别。 */
function validateSuite(suite, suites, label) {
  if (suite !== 'all' && !suites.includes(suite)) throw new Error(`不支持的${label}套件。`);
}

/** 保持快速任务与全语言任务的原有语言范围。
 * @param full - 是否为全语言运行。 */
function visualLocales(full) { return full ? ['zh-Hans', 'zh-Hant', 'en'] : ['zh-Hans']; }

/** Secret 必须包含完整账号池。
 * @param pool - 解析后的 Secret。 */
function validatePoolSize(pool) {
  if (!hasPoolAccounts(pool)) throw new Error('CI Secret 必须包含完整的 100 个 Web 专用账号。');
  if (pool.accounts.length !== ciAccounts.length) throw new Error('CI Secret 必须包含完整的 100 个 Web 专用账号。');
}

/** 核对密码类型、长度及控制字符。
 * @param password - Secret 中的密码。 */
function validPoolPassword(password) {
  if (typeof password !== 'string') return false;
  return [Boolean(password.trim()), password.length <= 20, !/[\r\n\0]/.test(password)].every(Boolean);
}

/** 逐账号核对身份、重复、ready 状态与密码。
 * @param accounts - 完整账号列表。 */
function validatePoolAccounts(accounts) {
  const seen = new Set();
  for (const account of accounts) {
    validatePoolAccount(account, seen);
    seen.add(account.username);
  }
  return seen;
}

/** 只允许未重复且已就绪的登记账号。
 * @param account - Secret 中的单个账号。
 * @param seen - 已见用户名。 */
function validatePoolAccount(account, seen) {
  if (!knownPoolAccount(account)) throw invalidPoolAccount();
  const checks = [!seen.has(account.username), account.status === 'ready', validPoolPassword(account.password)];
  if (!checks.every(Boolean)) throw invalidPoolAccount();
}

/** 返回统一错误，避免暴露 Secret 细节。 */
function invalidPoolAccount() { return new Error('CI Secret 包含重复、未就绪或无效凭据；请核对账号池备份。'); }

/** 所选账号和 Secret 必须属于同一完整的专用池。
 * @param seen - 实际验证的账号名。
 * @param username - 调度选中的账号。 */
function validatePoolSelection(seen, username) {
  if (!ciAccounts.every(/** 保留全池覆盖断言。
   * @param name - 登记用户名。 */ name => seen.has(name)) || !ciAccounts.includes(username)) {
    throw new Error('所选账号或 Secret 不属于本仓库的 Web 专用账号池。');
  }
}

/** 同时校验运行编号和槽位偏移。
 * @param runId - GitHub 运行编号。
 * @param offset - 槽位偏移。 */
function validAllocation(runId, offset) { return validRunId(runId) && validOffset(offset); }

/** 安全识别包含账号数组的 Secret。
 * @param pool - 解析后的 Secret。 */
function hasPoolAccounts(pool) { return Array.isArray(pool?.accounts); }

/** 安全识别已登记的账号名。
 * @param account - Secret 中的单个账号。 */
function knownPoolAccount(account) { return ciAccounts.includes(account?.username); }
