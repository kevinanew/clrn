/** 为已校验的 Release 静态目录提供独立 HTTP 服务；不构建应用，不代理业务接口。 */
import { randomUUID } from 'node:crypto';
import { observeReleaseResponse } from './release-diagnostics.mjs';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.wasm': 'application/wasm',
};

/**
 * 校验实际入口版本，避免仅凭压缩包标签把错误构建交给浏览器。
 * @param directory - 已解包的静态根目录。
 * @param expectedCommit - 预期的完整应用提交编号。
 */
export async function verifyBuildVersion(directory, expectedCommit) {
  if (!/^[a-f0-9]{40}$/.test(expectedCommit || '')) throw new Error('缺少完整应用提交编号');
  const html = await readFile(path.join(directory, 'index.html'), 'utf8');
  const tag = html.match(/<meta\b[^>]*\bname=["']build-version["'][^>]*>/i)?.[0];
  const actual = tag?.match(/\bcontent=["']([a-f0-9]{40})\s+-\s+[^"']+["']/i)?.[1];
  if (actual?.toLowerCase() !== expectedCommit) throw new Error('Release 入口应用版本不匹配');
}

/**
 * 在回环地址和随机端口启动服务；返回服务句柄供调用方在测试结束后关闭。
 * @param directory - 本任务独占的静态根目录。
 * @param options - 本轮日志出口与隔离自测的文件流边界。
 */
export async function startReleaseWebServer(directory, { record = () => {}, openStream = createReadStream } = {}) {
  const root = await realpath(directory);
  const serverId = randomUUID();
  const connections = new WeakMap();
  let sequence = 0;
  let connectionSequence = 0;
  const server = createServer(/**
   * 只提供根目录中的真实文件，缺失资源返回 404，避免把 HTML 误当脚本。
   * @param request - 浏览器请求。
   * @param response - HTTP 响应。
   */ async (request, response) => {
    if (!connections.has(request.socket)) connections.set(request.socket, `connection-${++connectionSequence}`);
    const requestId = `${serverId}-${++sequence}`;
    response.setHeader('X-Clrn-Release-Request', requestId);
    const diagnostic = observeReleaseResponse(request, response,
      { requestId, connectionId: connections.get(request.socket), serverId }, record);
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname.includes('\0') || pathname.includes('\\') || /\.map(?:\.(?:gz|br))?$/i.test(pathname)) {
        response.writeHead(404).end();
        return;
      }
      let filename = await realpath(path.resolve(root, `.${pathname}`));
      if (!filename.startsWith(`${root}${path.sep}`) && filename !== root) {
        response.writeHead(404).end();
        return;
      }
      let information = await stat(filename);
      if (information.isDirectory()) {
        filename = await realpath(path.join(filename, 'index.html'));
        information = await stat(filename);
      }
      if (!information.isFile() || !filename.startsWith(`${root}${path.sep}`)) {
        response.writeHead(404).end();
        return;
      }
      const extension = path.extname(filename).toLowerCase();
      response.writeHead(200, {
        'Content-Type': contentTypes[extension] || 'application/octet-stream',
        'Content-Length': information.size,
        'Cache-Control': /\.(gif|jpg|jpeg|png|webp|mp3|ttf|css|js)$/.test(filename)
          ? 'max-age=31536000' : 'no-store, max-age=0',
      });
      if (request.method === 'HEAD') response.end();
      else {
        const stream = openStream(filename);
        diagnostic.stream(stream);
        stream.on('error', /** 读取失败时继续中断响应，不伪造成功。 */ () => response.destroy()).pipe(response);
      }
    } catch {
      diagnostic.emit('release.file-unavailable');
      response.writeHead(404).end();
    }
  });
  await new Promise(/**
   * 等待服务完成监听后才允许测试访问。
   * @param resolve - 监听完成回调。
   * @param reject - 监听失败回调。
   */ (resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, serverId, baseUrl: `http://127.0.0.1:${server.address().port}/` };
}
