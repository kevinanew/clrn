/** 读取测试运行参数、账号及本轮 Release 或线上 Staging 入口。 */
import { readTestWebUrl } from "./web-target";

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
  stagingUrl: readTestWebUrl(process.env.E2E_STAGING_URL, process.env),
  testUsername: process.env.E2E_TEST_USERNAME || 'laiwanvisual01',
  testPassword: process.env.E2E_TEST_PASSWORD || 'visual2026test',
};
