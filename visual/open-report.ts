#!/usr/bin/env node

import { type ChildProcess, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const VISUAL_DIR = path.resolve(__dirname);
const REPORT_DIR = path.join(VISUAL_DIR, 'playwright-report');
const REPORT_PORT = process.env.VISUAL_REPORT_PORT || '8089';
const REPORT_URL = `http://127.0.0.1:${REPORT_PORT}`;

if (!fs.existsSync(path.join(REPORT_DIR, 'index.html'))) {
  console.error('未找到测试报告。请先运行 pnpm run test。');
  process.exit(1);
}

/**
 * 按操作系统调用浏览器打开本机报告地址。
 * @param url - 要访问的站点或本机服务地址。
 */
function openBrowser(url: string): void {
  const platform = process.platform;
  let command: string;
  let args: string[];

  if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  spawnSync(command, args, { stdio: 'ignore' });
}

/**
 * 等待本机报告服务响应，超过重试次数时报告启动失败。
 * @param url - 要访问的站点或本机服务地址。
 * @param maxAttempts - 等待服务就绪的最大探测次数。
 */
async function waitForServer(url: string, maxAttempts = 20): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // 服务尚未就绪
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  throw new Error(`报告服务未能成功启动于: ${url}`);
}

/** 启动本机报告服务，注册进程清理并在服务就绪后打开浏览器。 */
async function main(): Promise<void> {
  console.log(`正在托管目录: ${REPORT_DIR}`);

  const server: ChildProcess = spawn(
    'pnpm',
    ['exec', 'serve', 'playwright-report', '-l', REPORT_PORT, '--no-clipboard'],
    { cwd: VISUAL_DIR, stdio: 'inherit', env: process.env },
  );

  /** 结束报告服务子进程，避免关闭终端后遗留后台服务。 */
  const shutdown = () => {
    if (!server.killed) {
      server.kill('SIGTERM');
    }
  };

  process.on('SIGINT', () => {
    shutdown();
    process.exit(130);
  });

  process.on('SIGTERM', shutdown);

  server.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  await waitForServer(REPORT_URL);
  console.log(`正在打开报告链接: ${REPORT_URL}`);
  openBrowser(REPORT_URL);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
