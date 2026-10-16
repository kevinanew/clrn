import { readFileSync } from 'node:fs';

// 这里只维护公开账号名，密码统一保存在 CLRN_CI_TEST_ACCOUNTS_V2 Secret。
export const ciAccounts = JSON.parse(readFileSync(new URL('./ci-test-accounts.json', import.meta.url), 'utf8')).accounts;
if (ciAccounts.length !== 100 || new Set(ciAccounts.map(name => name.toLowerCase())).size !== 100) {
  throw new Error('CI 账号清单必须包含 100 个不同账号。');
}

// 两个仓库固定使用互不相交的账号；GitHub concurrency 仅在本仓库生效。
export const executionAccounts = ciAccounts.slice(0, 30);

/**
 * 按运行 ID 轮转账号槽位；账号级 GitHub concurrency 才负责跨 runner 互斥。
 * 同一次重跑复用相同槽位；不同任务若选到同一账号会排队，不会重复登录。
 * @param runId - GitHub Actions 运行 ID，使用字符串以免大整数丢失精度。
 * @param offset - 本轮任务相对起始槽位的偏移。
 * @returns 本任务使用的公开账号名。
 */
export function allocateCiAccount(runId, offset = 0) {
  if (typeof runId !== 'string' || !runId || /\D/.test(runId) || !Number.isSafeInteger(offset) || offset < 0 || offset >= executionAccounts.length) {
    throw new Error('CI 账号分配需要有效运行 ID 和账号槽位偏移。');
  }
  return executionAccounts[Number((BigInt(runId) + BigInt(offset)) % BigInt(executionAccounts.length))];
}

/**
 * 为视觉套件与语言组合分配不同账号，避免全量九个任务相互作废会话。
 * @param runId - 当前 GitHub Actions 运行 ID。
 * @param suite - all、app、texas 或 zhajinhua。
 * @param full - 是否覆盖全部三种语言。
 * @returns 可直接用于 GitHub Actions include 矩阵的任务配置。
 */
export function visualAccountMatrix(runId, suite = 'all', full = false) {
  // 保留账号槽位顺序；只将耗时较长的牌桌任务提前创建。
  const suites = ['app', 'texas', 'zhajinhua'];
  const executionOrder = ['texas', 'zhajinhua', ...suites.filter(item => item !== 'texas' && item !== 'zhajinhua')];
  if (suite !== 'all' && !suites.includes(suite)) throw new Error('不支持的视觉套件。');
  const locales = full ? ['zh-Hans', 'zh-Hant', 'en'] : ['zh-Hans'];
  return { include: executionOrder.filter(item => suite === 'all' || item === suite).flatMap(item =>
    locales.map((locale, index) => ({ suite: item, locale,
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
  if (suite !== 'all' && !suites.includes(suite)) throw new Error('不支持的动画套件。');
  const parts = {
    app: ['application', 'ui'],
    texas: ['table', 'gameplay', 'social'],
    zhajinhua: ['panels', 'gameplay'],
  };
  let offset = 12;
  return { include: suites.flatMap(item => parts[item].map(part => ({
    suite: item, part, account: allocateCiAccount(runId, offset++),
  }))).filter(item => suite === 'all' || item.suite === suite) };
}

/**
 * 从 Secret 中读取指定槽位的凭据，校验完整账号池并隐藏所有解析细节。
 * @param serialized - GitHub Actions Secret 中的账号池 JSON。
 * @param username - 调度阶段选出的公开账号名，必须属于 CI 专用清单。
 * @returns 指定 CI 账号的用户名和密码。
 */
export function ciAccountCredentials(serialized, username) {
  let pool;
  try { pool = JSON.parse(serialized); } catch { throw new Error('CLRN_CI_TEST_ACCOUNTS Secret 缺失或不是有效 JSON。'); }
  if (!Array.isArray(pool?.accounts) || ![executionAccounts.length, ciAccounts.length].includes(pool.accounts.length)) {
    throw new Error('CI Secret 必须包含完整的 30 个 Web 专用账号，或迁移前的 100 个账号。');
  }
  const seen = new Set();
  for (const account of pool.accounts) {
    if (!ciAccounts.includes(account?.username) || seen.has(account.username)
      || account.status !== 'ready' || typeof account.password !== 'string'
      || !account.password.trim() || account.password.length > 20 || /[\r\n\0]/.test(account.password)) {
      throw new Error('CI Secret 包含重复、未就绪或无效凭据；请核对账号池备份。');
    }
    seen.add(account.username);
  }
  if (!executionAccounts.every(name => seen.has(name)) || !executionAccounts.includes(username)) {
    throw new Error('所选账号或 Secret 不属于本仓库的专用账号分区。');
  }
  const selected = pool.accounts.find(account => account.username === username);
  if (!selected) throw new Error('所选账号不属于 CI 专用池。');
  return { username: selected.username, password: selected.password };
}
