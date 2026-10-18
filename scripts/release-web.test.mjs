/** 使用真实压缩包、HTTP 边界和测试子进程验证 Release 下载、版本隔离及服务器生命周期。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { prepareReleaseWeb } from './prepare-release-web.mjs';
import { startReleaseWebServer } from './release-web-server.mjs';

const execute = promisify(execFile);
const expectedCommit = 'a'.repeat(40);
const wrapper = fileURLToPath(new URL('./with-release-web-server.mjs', import.meta.url));

/**
 * 生成真实 gzip 归档，包括用于验证拒绝行为的越界路径或链接。
 * @param commit - 写入页面的完整构建提交。
 * @param extra - 可选的危险归档成员。
 */
function buildArchive(commit, extra) {
  return execFileSync('python3', ['-c', `
import io, json, sys, tarfile
specification = json.loads(sys.argv[1])
output = io.BytesIO()
with tarfile.open(fileobj=output, mode='w:gz') as archive:
    for name, contents in specification['files'].items():
        member = tarfile.TarInfo(name)
        data = contents.encode()
        member.size = len(data)
        archive.addfile(member, io.BytesIO(data))
    if specification.get('extra'):
        member = tarfile.TarInfo(specification['extra']['name'])
        if specification['extra'].get('link'):
            member.type = tarfile.SYMTYPE
            member.linkname = specification['extra']['link']
        archive.addfile(member, io.BytesIO())
sys.stdout.buffer.write(output.getvalue())
`, JSON.stringify({ files: {
    'index.html': `<meta name="build-version" content="${commit} - 2026-10-18T00:00:00Z"><script src="/assets/main.js"></script>`,
    'assets/main.js': `window.applicationCommit = '${commit}';`,
    'assets/font.woff2': 'font-contents', 'assets/main.js.map': 'must-not-be-public',
    ['assets/long-directory-name/'.repeat(5) + 'image.svg']: '<svg/>',
  }, extra })]);
}

/**
 * 计算真实内容摘要。
 * @param contents - 附件字节。
 */
function digest(contents) { return createHash('sha256').update(contents).digest('hex'); }

/**
 * 构造一致的发布记录和远端附件，网络响应仍经过真实 HTTP。
 * @param options - 可选构建提交、错误页面版本或危险归档成员。
 */
function releaseFixture({ commit = expectedCommit, pageCommit = commit, extra } = {}) {
  const archive = buildArchive(pageCommit, extra);
  const tag = `web-staging-42-${commit.slice(0, 12)}`;
  const artifact = { release_tag: tag, release_url: `https://github.com/kevinanew/clrn/releases/tag/${tag}`,
    name: 'web-staging.tar.gz', size: archive.length, sha256: digest(archive) };
  const information = Buffer.from(JSON.stringify({ schemaVersion: 1, platform: 'web', environment: 'staging',
    applicationCommit: commit, buildNumber: 42, releaseTag: tag,
    archive: { name: artifact.name, size: artifact.size, sha256: artifact.sha256 } }));
  const release = { tag_name: tag, draft: false, prerelease: true,
    body: `<!-- laiwan-web-staging-package -->\n应用提交：${commit}`, assets: [
      { id: 1, name: artifact.name, state: 'uploaded', size: archive.length, digest: `sha256:${digest(archive)}` },
      { id: 2, name: 'build-info.json', state: 'uploaded', size: information.length, digest: `sha256:${digest(information)}` },
    ] };
  return { commit, release, archive, information,
    content: JSON.stringify({ environment: 'staging', sha: commit, deployed_at: '2026-10-18T00:00:00Z', artifact }) };
}

/**
 * 将 GitHub 网络边界接到真实本地服务，每个用例拥有独立的临时目录。
 * @param fixture - 远端 Release 及附件内容。
 * @param operation - 验证实际下载、解包和浏览器入口的操作。
 */
async function withRelease(fixture, operation) {
  const directory = await mkdtemp(path.join(tmpdir(), 'clrn-release-test-'));
  const requests = [];
  const server = createServer(/**
   * 提供固定 Release 元数据及二进制附件。
   * @param request - 下载请求。
   * @param response - 网络响应。
   */ (request, response) => {
    requests.push(request.url);
    const body = request.url.endsWith('/assets/1') ? fixture.archive
      : request.url.endsWith('/assets/2') ? fixture.information : JSON.stringify(fixture.release);
    response.end(body);
  });
  await new Promise(/**
   * 等待真实边界服务监听。
   * @param resolve - 监听完成回调。
   */ resolve => server.listen(0, '127.0.0.1', resolve));
  const fetcher = /**
   * 仅替换请求地址，保留原生 HTTP 下载和摘要校验。
   * @param address - 生产 GitHub 地址。
   * @param options - 原生请求选项。
   */ (address, options) => fetch(address.replace('https://api.github.com', `http://127.0.0.1:${server.address().port}`), options);
  try {
    await operation({ content: fixture.content, temporaryDirectory: directory, fetcher }, requests);
  } finally {
    server.closeAllConnections();
    await new Promise(/**
     * 关闭网络边界。
     * @param resolve - 关闭完成回调。
     */ resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

test('下载指定 Release 的真实字节，核对构建信息并提供脚本、字体及版本入口', async () => {
  await withRelease(releaseFixture(), async (options, requests) => {
    const prepared = await prepareReleaseWeb(options);
    assert.equal(prepared.commit, expectedCommit);
    assert.equal(requests.length, 3);
    assert.match(requests[0], /releases\/tags\/web-staging-42-/);
    const { server, baseUrl } = await startReleaseWebServer(prepared.webRoot);
    try {
      assert.match(await (await fetch(baseUrl)).text(), new RegExp(expectedCommit));
      const script = await fetch(new URL('assets/main.js', baseUrl));
      assert.match(script.headers.get('content-type'), /javascript/);
      assert.match(await script.text(), new RegExp(expectedCommit));
      const font = await fetch(new URL('assets/font.woff2', baseUrl));
      assert.equal(font.headers.get('content-type'), 'font/woff2');
      for (const missing of ['missing.js', 'assets/main.js.map', '%2e%2e%2fbuild-info.json', '%00']) {
        assert.equal((await fetch(new URL(missing, baseUrl))).status, 404);
      }
      assert.equal((await fetch(baseUrl, { method: 'POST' })).status, 405);
      assert.equal(await (await fetch(baseUrl, { method: 'HEAD' })).text(), '');
    } finally { server.closeAllConnections(); server.close(); }
  });
});

test('拒绝实际字节损坏、构建信息错配和错误页面版本，不能回退 Staging', async () => {
  const corruptArchive = releaseFixture();
  corruptArchive.archive[10] ^= 1;
  await withRelease(corruptArchive, async options => {
    await assert.rejects(prepareReleaseWeb(options), /摘要或大小不匹配/);
  });
  const corruptInformation = releaseFixture();
  corruptInformation.information = Buffer.from(corruptInformation.information.toString().replace('staging', 'invalid'));
  corruptInformation.release.assets[1].digest = `sha256:${digest(corruptInformation.information)}`;
  await withRelease(corruptInformation, async options => {
    await assert.rejects(prepareReleaseWeb(options), /build-info.json/);
  });
  await withRelease(releaseFixture({ pageCommit: 'b'.repeat(40) }), async options => {
    await assert.rejects(prepareReleaseWeb(options), /入口应用版本不匹配/);
  });
  await withRelease(releaseFixture(), async (options, requests) => {
    await assert.rejects(prepareReleaseWeb({ ...options, expectedCommit: 'b'.repeat(40) }), /指定应用提交/);
    assert.equal(requests.length, 1);
  });
});

test('在写入站点目录前拒绝路径越界和符号链接', async () => {
  for (const extra of [{ name: '../outside' }, { name: '/tmp/outside' }, { name: 'linked', link: '/tmp' }]) {
    await withRelease(releaseFixture({ extra }), async options => {
      await assert.rejects(prepareReleaseWeb(options), /不允许的路径或文件类型/);
    });
  }
});

test('两个版本同时启动时各自提供固定包，后来的版本不覆盖前者', async () => {
  await withRelease(releaseFixture(), async firstOptions => {
    await withRelease(releaseFixture({ commit: 'b'.repeat(40) }), async secondOptions => {
      const first = await prepareReleaseWeb(firstOptions);
      const second = await prepareReleaseWeb(secondOptions);
      const firstServer = await startReleaseWebServer(first.webRoot);
      const secondServer = await startReleaseWebServer(second.webRoot);
      try {
        assert.notEqual(firstServer.baseUrl, secondServer.baseUrl);
        for (const { server, prepared } of [{ server: firstServer, prepared: first }, { server: secondServer, prepared: second }]) {
          assert.match(await (await fetch(server.baseUrl)).text(), new RegExp(prepared.commit));
        }
      } finally {
        for (const { server } of [firstServer, secondServer]) { server.closeAllConnections(); server.close(); }
      }
    });
  });
});

test('完整测试命令继承同一入口，失败退出码和取消均会关闭服务器', async () => {
  await withRelease(releaseFixture(), async options => {
    const prepared = await prepareReleaseWeb(options);
    const environment = { ...process.env, CLRN_RELEASE_WEB_ROOT: prepared.webRoot,
      CLRN_EXPECTED_APPLICATION_COMMIT: prepared.commit };
    const result = await execute(process.execPath, [wrapper, process.execPath, '-e', `
      require('node:assert/strict').equal(process.env.E2E_STAGING_URL, process.env.VISUAL_BASE_URL);
      fetch(process.env.VISUAL_BASE_URL).then(response => response.text()).then(html => {
        require('node:assert/strict').match(html, new RegExp(process.env.CLRN_EXPECTED_APPLICATION_COMMIT));
        console.log('verified');
      });`], { env: environment });
    assert.match(result.stdout, /verified/);
    const address = result.stdout.match(/http:\/\/127\.0\.0\.1:\d+\//)[0];
    await assert.rejects(fetch(address));
    await assert.rejects(execute(process.execPath, [wrapper, process.execPath, '-e', 'process.exit(17)'],
      { env: environment }), { code: 17 });
    const outputFile = path.join(path.dirname(prepared.webRoot), 'child-ready');
    const child = spawn(process.execPath, [wrapper, process.execPath, '-e', `
      require('node:fs').writeFileSync(process.argv[1], process.env.VISUAL_BASE_URL);
      setInterval(() => {}, 1000);`, outputFile], { env: environment, stdio: 'ignore' });
    const completion = new Promise(resolve => child.once('exit', resolve));
    let cancelledAddress;
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        cancelledAddress = await readFile(outputFile, 'utf8').catch(() => undefined);
        if (cancelledAddress) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(cancelledAddress, '测试子进程必须在取消前完成启动');
      child.kill('SIGTERM');
      assert.notEqual(await completion, 0);
      await assert.rejects(fetch(cancelledAddress));
    } finally { child.kill('SIGKILL'); }
  });
});

test('所有发布调用固定记录和检出提交，各套件执行前准备 Release 并包装浏览器命令', async () => {
  const parent = await readFile(new URL('../.github/workflows/staging-deployment.yml', import.meta.url), 'utf8');
  assert.match(parent, /cancel-in-progress: false\n {2}queue: max/);
  assert.equal(parent.split('release_record: ${{ needs.deployment.outputs.release_record }}').length - 1, 5);
  for (const name of ['e2e', 'functional', 'interactions', 'visual', 'animations']) {
    const workflow = await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
    assert.match(workflow, /ref: \$\{\{ github.sha \}\}/);
    assert.match(workflow, /uses: \.\/\.github\/actions\/prepare-release-web/);
    assert.match(workflow, /release-record: \$\{\{ inputs.release_record/);
    assert.match(workflow, /with-release-web-server.mjs/);
    assert.doesNotMatch(workflow, /staging-deployment.mjs (wait|verify)/);
    assert.ok(workflow.indexOf('uses: ./.github/actions/prepare-release-web')
      < workflow.indexOf('node ../scripts/with-release-web-server.mjs'));
  }
});
