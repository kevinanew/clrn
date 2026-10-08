import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const STARTUP_TIMEOUT_MS = 90_000;
const STARTUP_POLL_MS = 100;
const SHUTDOWN_TIMEOUT_MS = 2_000;
const MAX_DIAGNOSTIC_LENGTH = 8_000;

/** 管理一个 mitmdump 进程，负责启动诊断、就绪检查和退出。 */
export class MitmdumpProcess {
  private startupError?: Error;
  private diagnostics = '';
  private readonly exited: Promise<void>;

  constructor(private readonly child: ChildProcess) {
    const captureOutput = (data: Buffer) => {
      this.diagnostics = (this.diagnostics + data.toString()).slice(-MAX_DIAGNOSTIC_LENGTH);
    };
    child.stdout?.on('data', captureOutput);
    child.stderr?.on('data', captureOutput);
    child.on('error', error => { this.startupError = error; });
    this.exited = new Promise(resolve => child.once('close', () => resolve()));
  }

  private get isRunning(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null;
  }

  async waitUntilReady(checkStatus: () => Promise<unknown>): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (true) {
      if (this.startupError || !this.isRunning) {
        const reason = this.startupError?.message || this.diagnostics;
        throw new Error(`mitmproxy 启动失败；请安装 e2e/mitmproxy/requirements.txt。\n${reason}`);
      }
      try {
        await checkStatus();
        return;
      } catch {
        if (Date.now() >= deadline) {
          throw new Error(`mitmproxy 启动超时。\n${this.diagnostics}`);
        }
        await delay(STARTUP_POLL_MS);
      }
    }
  }

  async stop(): Promise<void> {
    if (this.isRunning) this.child.kill('SIGTERM');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.exited,
        new Promise<void>(resolve => { timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (this.isRunning) this.child.kill('SIGKILL');
    await this.exited;
  }
}

export function startMitmdump(port: number, directory: string, token: string,
  addonPath = path.resolve(__dirname, '../mitmproxy/network_faults.py')): MitmdumpProcess {
  const executable = process.env.MITMDUMP_PATH || process.env.E2E_MITMDUMP_PATH
    || path.resolve(__dirname, '../.venv/bin/mitmdump');
  const child = spawn(executable, [
    '--listen-host', '127.0.0.1',
    '--listen-port', String(port),
    '--set', `confdir=${directory}`,
    '--set', 'connection_strategy=lazy',
    '--set', 'flow_detail=0',
    '--set', 'termlog_verbosity=error',
    '-s', addonPath,
  ], {
    env: { ...process.env, MITMPROXY_CONTROL_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new MitmdumpProcess(child);
}
