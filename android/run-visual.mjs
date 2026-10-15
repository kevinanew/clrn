import { spawnSync } from 'node:child_process';
const mode = process.env.ANDROID_VISUAL_MODE || 'compare';
if (!['compare', 'reference'].includes(mode)) throw new Error('ANDROID_VISUAL_MODE 必须为 compare 或 reference。');
const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test',
  '--config', 'android/playwright.config.ts',
  ...(process.env.ANDROID_FILTER ? ['--grep', process.env.ANDROID_FILTER] : []), ...(mode === 'reference' ? ['--update-snapshots=all'] : [])],
{ stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
