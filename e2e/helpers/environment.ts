/**
 * 读取非负整数环境配置，缺失时使用默认值，格式错误时立即失败。
 * @param name - 需要读取的环境变量名。
 * @param fallback - 配置缺失时采用的默认值。
 */
function readInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} 必须是非负整数`);
  }
  return value;
}

/** 读取并校验部署入口的 HTTPS 协议与 staging 域名。 */
function readStagingUrl(): string {
  const name = 'E2E_STAGING_URL';
  const raw = process.env[name] || 'https://h5.page.shafayouxi.org/';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} 必须是有效的 HTTPS URL`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${name} 必须是 HTTPS URL`);
  }
  if (!['h5.page.shafayouxi.org', 'h5.shafayouxi.org'].includes(url.hostname)) {
    throw new Error(`${name} 必须指向已部署的来玩 staging 域名，禁止本地环境及 production 登录`);
  }
  return url.href;
}

export const runtime = {
  workers: readInteger('E2E_WORKERS', 2),
  retries: readInteger('E2E_RETRIES', 1),
};

const expectedBuildSha = process.env.E2E_EXPECT_BUILD_SHA?.toLowerCase();
if (expectedBuildSha && !/^[a-f0-9]{7,}$/.test(expectedBuildSha)) {
  throw new Error('E2E_EXPECT_BUILD_SHA 必须是至少 7 位的十六进制提交 SHA 前缀');
}

export const environment = {
  expectedBuildSha,
  stagingUrl: readStagingUrl(),
  testUsername: process.env.E2E_TEST_USERNAME || 'laiwanvisual01',
  testPassword: process.env.E2E_TEST_PASSWORD || 'visual2026test',
};
