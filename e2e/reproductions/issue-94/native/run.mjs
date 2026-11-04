/** Hold the second exclusive account while a native case owns its services and evidence. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const output = path.join(repository, 'e2e/test-results/issue-94', process.env.ISSUE94_RUN_ID, 'native');
const child = spawn(process.execPath, [
  'scripts/with-test-account.mjs', '--', process.execPath, 'scripts/with-release-web-server.mjs',
  'python3', 'e2e/reproductions/issue-94/native/runtime.py', '--',
  process.execPath, 'visual/node_modules/tsx/dist/cli.mjs', 'e2e/reproductions/issue-94/native/browser.mts',
], { cwd: repository, stdio: 'inherit', env: {
  ...process.env, ISSUE94_PEER_USERNAME: process.env.E2E_TEST_USERNAME,
  ISSUE94_PEER_PASSWORD: process.env.E2E_TEST_PASSWORD, ISSUE94_NATIVE_EVIDENCE_DIRECTORY: output,
} });
const interrupt = /** Forward cancellation so native services and both account locks are cleaned. */ () => child.kill('SIGINT');
const terminate = /** Forward termination through the existing lifecycle wrappers. */ () => child.kill('SIGTERM');
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);
try {
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
} finally {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
}
