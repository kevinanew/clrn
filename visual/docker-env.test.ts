import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  scripts: Record<string, string>;
};

describe('visual Docker environment forwarding', () => {
  test('public Docker scripts forward VISUAL_SCOPE from the host', () => {
    for (const scriptName of ['test', 'test:all', 'test:locales', 'reference:zh', 'approve']) {
      assert.match(packageJson.scripts[scriptName], /(?:^| )-e VISUAL_SCOPE(?: |$)/, scriptName);
    }
  });

  test('multi-locale reference and Compose configuration forward VISUAL_SCOPE', () => {
    const referenceHost = readFileSync(new URL('./reference-host.sh', import.meta.url), 'utf8');
    const dockerCompose = readFileSync(new URL('./docker-compose.yml', import.meta.url), 'utf8');

    assert.match(referenceHost, /-e VISUAL_SCOPE/);
    assert.match(dockerCompose, /VISUAL_SCOPE: \$\{VISUAL_SCOPE:-\}/);
  });
});
