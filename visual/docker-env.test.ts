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

  test('Docker entries preserve suite selection and let the runner choose its default account', () => {
    for (const scriptName of ['test', 'test:all', 'test:locales', 'reference:zh', 'approve']) {
      assert.match(packageJson.scripts[scriptName], /(?:^| )-e VISUAL_SUITE(?: |$)/, scriptName);
    }
    assert.match(packageJson.scripts['test:app'], /-e VISUAL_SUITE=app/);
    assert.match(packageJson.scripts['test:texas'], /-e VISUAL_SUITE=texas/);
    const compose = readFileSync(new URL('./docker-compose.yml', import.meta.url), 'utf8');
    assert.match(compose, /VISUAL_SUITE: \$\{VISUAL_SUITE:-all\}/);
    assert.match(compose, /VISUAL_USERNAME: \$\{VISUAL_USERNAME:-\}/);
    const reference = readFileSync(new URL('./reference-host.sh', import.meta.url), 'utf8');
    assert.match(reference, /-e VISUAL_SUITE/);
  });

  test('multi-locale reference and Compose configuration forward VISUAL_SCOPE', () => {
    const referenceHost = readFileSync(new URL('./reference-host.sh', import.meta.url), 'utf8');
    const dockerCompose = readFileSync(new URL('./docker-compose.yml', import.meta.url), 'utf8');

    assert.match(referenceHost, /-e VISUAL_SCOPE/);
    assert.match(dockerCompose, /VISUAL_SCOPE: \$\{VISUAL_SCOPE:-\}/);
  });

  test('only visual run commands forward the host testing token', () => {
    for (const scriptName of ['test', 'test:all', 'test:locales', 'reference:zh', 'approve']) {
      assert.match(packageJson.scripts[scriptName], /(?:^| )-e TESTING_API_TOKEN(?: |$)/, scriptName);
    }
    const referenceHost = readFileSync(new URL('./reference-host.sh', import.meta.url), 'utf8');
    assert.match(referenceHost, /-e TESTING_API_TOKEN/);
  });
});
