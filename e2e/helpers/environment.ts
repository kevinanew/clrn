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

function readRequiredUrl(name: string): string {
  const raw = process.env[name];
  if (!raw) {
    throw new Error(`${name} 必须通过环境变量提供`);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} 必须是有效的 HTTPS URL`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${name} 必须是 HTTPS URL`);
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
  stagingUrl: readRequiredUrl('E2E_STAGING_URL'),
  testUsername: process.env.E2E_TEST_USERNAME || 'laiwanvisual01',
  testPassword: process.env.E2E_TEST_PASSWORD || 'visual2026test',
};
