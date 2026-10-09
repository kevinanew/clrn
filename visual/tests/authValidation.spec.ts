import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, type Page, test } from '@playwright/test';
import { isSignedIn, waitForSignInState } from '../src/support/authFlow';
const AUTH_STORAGE_KEY = 'save.user.origin.data.from.server.key';
const COMPLETE_AUTH = {
  user_id: 'visual-user',
  api_token: { access_token: 'valid-token', token_type: 'Bearer' },
};

/**
 * 启动本机认证测试服务，返回独立地址和异步关闭方法。
 * @param handler - 处理本机测试请求并生成响应的函数。
 */
async function startTestServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  server.keepAliveTimeout = 1;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    /** 关闭本机测试资源，供测试验证清理时机及错误传播。 */
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

/**
 * 打开本机认证测试页面，为缓存与界面状态断言建立同源环境。
 * @param page - 执行操作的 Playwright 页面。
 * @param origin - 允许使用的页面来源。
 */
async function openAuthFixture(page: Page, origin: string): Promise<void> {
  await page.goto(origin);
}

/**
 * 在测试页面写入指定认证缓存，用于验证完整或无效会话。
 * @param page - 执行操作的 Playwright 页面。
 * @param auth - 需要写入的完整或无效认证缓存。
 */
async function setPersistedAuth(page: Page, auth: unknown = COMPLETE_AUTH): Promise<void> {
  await page.evaluate(
    ({ storageKey, value }) => window.localStorage.setItem(storageKey, JSON.stringify(value)),
    { storageKey: AUTH_STORAGE_KEY, value: auth },
  );
}

test('a stale level badge cannot mask a cleared signed-in cache', async ({ page }) => {
  await page.setContent(`
    <div data-testid="hall-user-level-text">Lv 1</div>
    <button data-testid="hall-sign-in-button">登录</button>
  `);

  await expect(isSignedIn(page)).resolves.toBe(false);
  await expect(waitForSignInState(page)).resolves.toBe('signedOut');
});

test('missing user id or token is signed out without an account request', async ({ page }) => {
  let accountRequestCount = 0;
  const server = await startTestServer((request, response) => {
    if (request.url?.startsWith('/v11/user/')) {
      accountRequestCount += 1;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<div id="root"></div>');
  });

  try {
    await openAuthFixture(page, server.origin);
    for (const incompleteAuth of [
      { api_token: { access_token: 'token', token_type: 'Bearer' } },
      { user_id: 'visual-user' },
      { user_id: 'visual-user', api_token: { access_token: 'token' } },
    ]) {
      await setPersistedAuth(page, incompleteAuth);
      await expect(waitForSignInState(page, { apiBaseUrl: server.origin })).resolves.toBe(
        'signedOut',
      );
    }
    expect(accountRequestCount).toBe(0);
  } finally {
    await server.close();
  }
});

test('account validation waits past three seconds for a 200 response', async ({ page }) => {
  let requestedPath = '';
  let authorization = '';
  const server = await startTestServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<div id="root"></div>');
      return;
    }
    requestedPath = request.url || '';
    authorization = request.headers.authorization || '';
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, result: {} }));
    }, 3200);
  });

  try {
    await openAuthFixture(page, server.origin);
    await setPersistedAuth(page);
    const startedAt = Date.now();

    await expect(waitForSignInState(page, { apiBaseUrl: server.origin })).resolves.toBe('signedIn');

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(3000);
    expect(requestedPath).toBe('/v11/user/visual-user/account');
    expect(authorization).toBe('Bearer valid-token');
  } finally {
    await server.close();
  }
});

test('account validation also waits for the app login state to remain stable when requested', async ({
  page,
}) => {
  const server = await startTestServer((request, response) => {
    response.writeHead(200, {
      'Content-Type': request.url === '/' ? 'text/html' : 'application/json',
    });
    response.end(request.url === '/' ? '<div id="root"></div>' : JSON.stringify({ ok: true }));
  });

  try {
    await openAuthFixture(page, server.origin);
    await setPersistedAuth(page);
    await page.setContent(
      '<div data-testid="hall-auth-state-signed-in">signed in</div><button data-testid="hall-sign-in-button" style="display: none">sign in</button>',
    );
    const startedAt = Date.now();

    await expect(
      waitForSignInState(page, { apiBaseUrl: server.origin, requireAppState: true }),
    ).resolves.toBe('signedIn');

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(2800);
  } finally {
    await server.close();
  }
});

test('app cache removal after a successful account check is signed out', async ({ page }) => {
  const server = await startTestServer((request, response) => {
    response.writeHead(200, {
      'Content-Type': request.url === '/' ? 'text/html' : 'application/json',
    });
    response.end(request.url === '/' ? '<div id="root"></div>' : JSON.stringify({ ok: true }));
  });

  try {
    await openAuthFixture(page, server.origin);
    await setPersistedAuth(page);
    await page.setContent('<div data-testid="hall-auth-state-signed-in">signed in</div>');
    const state = waitForSignInState(page, { apiBaseUrl: server.origin, requireAppState: true });
    await page.waitForTimeout(200);
    await page.evaluate(
      (storageKey) => window.localStorage.removeItem(storageKey),
      AUTH_STORAGE_KEY,
    );

    await expect(state).resolves.toBe('signedOut');
  } finally {
    await server.close();
  }
});

test('a 401 close to the real request timeout is never accepted as signed in', async ({ page }) => {
  const server = await startTestServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<div id="root"></div>');
      return;
    }
    setTimeout(() => {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end('{}');
    }, 9000);
  });

  try {
    await openAuthFixture(page, server.origin);
    await setPersistedAuth(page, {
      user_id: 'stale-user',
      api_token: { access_token: 'stale-token', token_type: 'Bearer' },
    });
    const startedAt = Date.now();

    await expect(waitForSignInState(page, { apiBaseUrl: server.origin })).resolves.toBe(
      'signedOut',
    );
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(8800);
  } finally {
    await server.close();
  }
});

test('clearing auth cache while account validation is pending returns signed out', async ({
  page,
}) => {
  const server = await startTestServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<div id="root"></div>');
      return;
    }
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{}');
    }, 1000);
  });

  try {
    await openAuthFixture(page, server.origin);
    await setPersistedAuth(page);
    const state = waitForSignInState(page, { apiBaseUrl: server.origin });
    await page.waitForTimeout(200);
    await page.evaluate(
      (storageKey) => window.localStorage.removeItem(storageKey),
      AUTH_STORAGE_KEY,
    );

    await expect(state).resolves.toBe('signedOut');
  } finally {
    await server.close();
  }
});

test('a failing optional level request does not affect successful account validation', async ({
  page,
}) => {
  const server = await startTestServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<div id="root"></div>');
      return;
    }
    if (request.url === '/v10/profile/visual-user') {
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end('{}');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, result: {} }));
  });

  try {
    await openAuthFixture(page, server.origin);
    await setPersistedAuth(page);
    const levelResponseStatus = page.evaluate(
      async () => (await fetch('/v10/profile/visual-user')).status,
    );

    await expect(levelResponseStatus).resolves.toBe(503);
    await expect(waitForSignInState(page, { apiBaseUrl: server.origin })).resolves.toBe('signedIn');
  } finally {
    await server.close();
  }
});

test('account validation fails explicitly on 429 and 503', async ({ page }) => {
  for (const failureStatus of [429, 503]) {
    const server = await startTestServer((request, response) => {
      response.writeHead(request.url === '/' ? 200 : failureStatus, {
        'Content-Type': request.url === '/' ? 'text/html' : 'application/json',
      });
      response.end(request.url === '/' ? '<div id="root"></div>' : '{}');
    });

    try {
      await openAuthFixture(page, server.origin);
      await setPersistedAuth(page);
      await expect(waitForSignInState(page, { apiBaseUrl: server.origin })).rejects.toThrow(
        `HTTP ${failureStatus}`,
      );
    } finally {
      await server.close();
    }
  }
});

test('account validation fails explicitly on a network error', async ({ page }) => {
  const server = await startTestServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<div id="root"></div>');
      return;
    }
    response.socket?.destroy();
  });

  try {
    await openAuthFixture(page, server.origin);
    await setPersistedAuth(page);
    await expect(waitForSignInState(page, { apiBaseUrl: server.origin })).rejects.toThrow(
      '网络错误或超时',
    );
  } finally {
    await server.close();
  }
});

test('account validation fails explicitly on request timeout', async ({ page }) => {
  const server = await startTestServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<div id="root"></div>');
      return;
    }
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{}');
    }, 500);
  });

  try {
    await openAuthFixture(page, server.origin);
    await setPersistedAuth(page);
    const error = await waitForSignInState(page, { apiBaseUrl: server.origin, requestTimeoutMs: 100 })
      .then(() => null, failure => failure as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain('网络错误或超时');
    expect(error!.message).toContain('Timeout');
    expect(error!.message).not.toContain('Authorization');
    expect(error!.message).not.toContain(COMPLETE_AUTH.api_token.access_token);
  } finally {
    await server.close();
  }
});
