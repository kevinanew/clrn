import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';

export type FaultScenario = 'hall-timeout' | 'login-failure' | 'club-failure';
type ProxyStatus = { scenario: FaultScenario | null; interceptedRequests: number };

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法分配 mitmproxy 端口');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

export class Mitmproxy {
  readonly server: string;

  constructor(private readonly port: number, private readonly token: string) {
    this.server = `http://127.0.0.1:${port}`;
  }

  private control(endpoint: string, scenario?: FaultScenario | null): Promise<ProxyStatus> {
    return new Promise((resolve, reject) => {
      const body = scenario === undefined ? undefined : JSON.stringify({ scenario });
      const req = request({
        hostname: '127.0.0.1',
        port: this.port,
        path: `http://e2e-mitmproxy.invalid/${endpoint}`,
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Host: 'e2e-mitmproxy.invalid',
          'X-E2E-Control-Token': this.token,
          'Content-Type': 'application/json',
        },
      }, response => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { data += chunk; });
        response.on('error', reject);
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`mitmproxy 控制请求失败：HTTP ${response.statusCode}`));
            return;
          }
          try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
        });
      });
      req.on('error', reject);
      req.setTimeout(1_000, () => req.destroy(new Error('mitmproxy 控制请求超时')));
      req.end(body);
    });
  }

  status(): Promise<ProxyStatus> { return this.control('status'); }
  inject(scenario: FaultScenario): Promise<ProxyStatus> { return this.control('scenario', scenario); }
  clear(): Promise<ProxyStatus> { return this.control('scenario', null); }
}

export const test = base.extend<{ mitmproxy: Mitmproxy }>({
  mitmproxy: async ({}, use) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'e2e-mitmproxy-'));
    const token = randomBytes(32).toString('hex');
    const executable = process.env.E2E_MITMDUMP_PATH || path.resolve(
      __dirname, '../.venv', process.platform === 'win32' ? 'Scripts/mitmdump.exe' : 'bin/mitmdump',
    );
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const port = await unusedPort();
      const proxy = new Mitmproxy(port, token);
      child = spawn(executable, [
        '--listen-host', '127.0.0.1', '--listen-port', String(port),
        '--set', `confdir=${directory}`, '--set', 'connection_strategy=lazy',
        '--set', 'flow_detail=0', '--set', 'termlog_verbosity=error',
        '-s', path.resolve(__dirname, '../mitmproxy/network_faults.py'),
      ], {
        env: { ...process.env, E2E_MITMPROXY_CONTROL_TOKEN: token },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let failure: Error | undefined;
      let diagnostics = '';
      const capture = (data: Buffer) => { diagnostics = (diagnostics + data.toString()).slice(-8_000); };
      child.stdout?.on('data', capture);
      child.stderr?.on('data', capture);
      child.on('error', error => { failure = error; });
      const exited = new Promise<void>(resolve => child!.once('close', () => resolve()));
      try {
        const deadline = Date.now() + 20_000;
        while (true) {
          if (failure || child.exitCode !== null || child.signalCode !== null) {
            throw new Error(`mitmproxy 启动失败；请安装 e2e/mitmproxy/requirements.txt。\n${failure?.message || diagnostics}`);
          }
          try { await proxy.status(); break; } catch {
            if (Date.now() >= deadline) throw new Error(`mitmproxy 启动超时。\n${diagnostics}`);
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        await use(proxy);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          exited,
          new Promise<void>(resolve => { timer = setTimeout(resolve, 2_000); }),
        ]);
        clearTimeout(timer);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await exited;
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  proxy: async ({ mitmproxy }, use) => {
    await use({ server: mitmproxy.server, bypass: '<-loopback>' });
  },
  // Certificate errors are ignored only in these contexts; OS trust is unchanged.
  ignoreHTTPSErrors: true,
});

export { expect };
