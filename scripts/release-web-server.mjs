/** 为已校验的 Release 静态目录提供独立 HTTP 服务；不构建应用，不代理业务接口。 */
import { randomUUID } from 'node:crypto';
import { observeReleaseConnection, observeReleaseResponse } from './release-diagnostics.mjs';
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
 * 传输静态文件；由响应的生命周期管理文件源。
 * @param stream - 本次请求独占的文件流。
 * @param response - 实际 HTTP 响应或隔离测试的可写边界。
 */
export function pipeReleaseFile(stream, response) {
  /** 客户端退出后立即释放源；destroy 也会等待尚未完成的文件打开再关闭句柄。 */
  const destroySource = () => stream.destroy();
  response.once('close', destroySource);
  stream.once('close', /** 文件源关闭时移除响应关闭监听器，避免残留引用。 */ () => response.removeListener('close', destroySource));
  stream.once('error', /** 文件源发生错误时销毁响应，终止不完整传输。 */ () => response.destroy());
  if (response.destroyed) { stream.destroy(); return; }
  // 取消时无 error 的 destroy 不伪造文件读取错误，响应仍记录 interrupted。
  stream.pipe(response);
}

/**
 * 校验实际入口版本，避免仅凭压缩包标签把错误构建交给浏览器。
 * @param directory - 已解包的静态根目录。
 * @param expectedCommit - 预期的完整应用提交编号。
 */
export async function verifyBuildVersion(directory, expectedCommit) {
  if (!validBuildCommit(expectedCommit)) throw new Error('缺少完整应用提交编号');
  const html = await readFile(path.join(directory, 'index.html'), 'utf8');
  if (releaseBuildCommit(html) !== expectedCommit) throw new Error('Release 入口应用版本不匹配');
}

/** 读取入口中固定格式的 build-version 标签。
 * @param html - 实际入口正文。 */
export function releaseBuildCommit(html) {
  const tag = html.match(/<meta\b[^>]*\bname=["']build-version["'][^>]*>/i)?.[0];
  return commitFromTag(tag);
}

/** 解析标签中的完整提交，保持缺失标签的结果。
 * @param tag - build-version 标签。 */
function commitFromTag(tag) {
  const commit = tag?.match(/\bcontent=["']([a-f0-9]{40})\s+-\s+[^"']+["']/i)?.[1];
  return normalizeBuildCommit(commit);
}

/** 将实际提交归一为小写。
 * @param commit - 标签中的提交。 */
function normalizeBuildCommit(commit) { return commit?.toLowerCase(); }

/**
 * 在回环地址和随机端口启动服务；返回服务句柄供调用方在测试结束后关闭。
 * @param directory - 本任务独占的静态根目录。
 * @param options - 本轮日志出口与隔离自测的文件流边界。
 */
export async function startReleaseWebServer(directory, options = {}) {
  const { record, openStream } = serverOptions(options);
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
    // 本地静态资源每次响应后关闭上游连接，避免代理在空闲 FIN 尚未处理时复用旧连接。
    // 不改变业务连接、HTTP 状态、文件传输结果或重试次数。
    response.setHeader('Connection', 'close');
    const requestId = `${serverId}-${++sequence}`;
    response.setHeader('X-Clrn-Release-Request', requestId);
    const diagnostic = observeReleaseResponse(request, response,
      { requestId, connectionId: connections.get(request.socket), serverId }, record);
    try {
      await serveReleaseRequest(request, response, { root, openStream, diagnostic });
    } catch {
      diagnostic.emit('release.file-unavailable');
      response.writeHead(404).end();
    }
  });
  server.on('connection', /** 为新 TCP 连接分配标识并安装发布连接诊断监听。
 * @param socket - 当前网络连接。 */ socket => {
    const connectionId = `connection-${++connectionSequence}`;
    connections.set(socket, connectionId);
    observeReleaseConnection(socket, { serverId, connectionId }, record);
  });
  await new Promise(/**
   * 等待服务完成监听后才允许测试访问。
   * @param resolve - 监听完成回调。
   * @param reject - 监听失败回调。
   */ (resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  record({ event: 'release.listen', observedAt: Date.now(), source: 'release-static', serverId,
    keepAliveTimeoutMs: server.keepAliveTimeout,
    keepAliveTimeoutBufferMs: Number.isInteger(server.keepAliveTimeoutBuffer) ? server.keepAliveTimeoutBuffer : 'unavailable' });
  return { server, serverId, baseUrl: `http://127.0.0.1:${server.address().port}/` };
}

/** 设置可替换边界的原始默认值。
 * @param options - 调用方配置。 */
function serverOptions({ record = /** 未配置诊断时保持服务流程。 */ () => {}, openStream = createReadStream }) {
  return { record, openStream };
}

/** 将固定响应状态结束在一个出口。
 * @param response - 实际响应。
 * @param status - HTTP 状态。 */
function endStatus(response, status) { response.writeHead(status).end(); }

/** 按原有规则拒绝空字节、反斜杠及源码映射。
 * @param pathname - 解码后的 URL 路径。 */
function blockedPath(pathname) {
  return [pathname.includes('\0'), pathname.includes('\\'), /\.map(?:\.(?:gz|br))?$/i.test(pathname)].some(Boolean);
}

/** 核对真实文件系统路径位于根目录内，根本身可用于目录索引。
 * @param filename - realpath 后的目标。
 * @param root - realpath 后的根目录。 */
function withinRoot(filename, root) { return filename.startsWith(`${root}${path.sep}`) || filename === root; }

/** 解析真实文件或目录索引，保持符号链接边界检查。
 * @param pathname - 解码后的请求路径。
 * @param root - 静态根目录。 */
async function releaseFile(pathname, root) {
  let filename = await realpath(path.resolve(root, `.${pathname}`));
  if (!withinRoot(filename, root)) return undefined;
  let information = await stat(filename);
  if (information.isDirectory()) {
    filename = await realpath(path.join(filename, 'index.html'));
    information = await stat(filename);
  }
  return verifiedFile(filename, information, root);
}

/** 文件必须是根目录下的普通文件。
 * @param filename - 真实目标。
 * @param information - 实际 stat。
 * @param root - 静态根目录。 */
function verifiedFile(filename, information, root) {
  if (!information.isFile() || !filename.startsWith(`${root}${path.sep}`)) return undefined;
  return { filename, information };
}

/** 分发方法和路径校验，文件不存在时保持 404。
 * @param request - 浏览器请求。
 * @param response - 实际响应。
 * @param context - 根目录、文件流和诊断出口。 */
async function serveReleaseRequest(request, response, context) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (blockedPath(pathname)) return endStatus(response, 404);
  return serveReleasePath(pathname, request, response, context);
}

/** 文件核验期间退出的客户端不再打开文件源。
 * @param pathname - 已核验的 URL 路径。
 * @param request - 浏览器请求。
 * @param response - 实际响应。
 * @param context - 根目录、文件流和诊断出口。 */
async function serveReleasePath(pathname, request, response, context) {
  const file = await releaseFile(pathname, context.root);
  if (!file) return endStatus(response, 404);
  if (response.destroyed) return;
  response.writeHead(200, releaseHeaders(file));
  sendReleaseFile(file.filename, request, response, context);
}

/** 保持缓存策略、类型与实际内容长度。
 * @param file - 已核验的文件信息。 */
function releaseHeaders({ filename, information }) {
  return { 'Content-Type': contentTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream',
    'Content-Length': information.size,
    'Cache-Control': /\.(gif|jpg|jpeg|png|webp|mp3|ttf|css|js)$/.test(filename) ? 'max-age=31536000' : 'no-store, max-age=0' };
}

/** HEAD 不打开文件流，GET 保持诊断与响应生命周期联动。
 * @param filename - 已核验的真实路径。
 * @param request - 浏览器请求。
 * @param response - 实际响应。
 * @param context - 文件流边界和诊断出口。 */
function sendReleaseFile(filename, request, response, context) {
  if (request.method === 'HEAD') return response.end();
  const stream = context.openStream(filename);
  context.diagnostic.stream(stream);
  pipeReleaseFile(stream, response);
}

/** 校验预期的完整应用提交格式。
 * @param commit - 调用方固定提交。 */
function validBuildCommit(commit) { return /^[a-f0-9]{40}$/.test(commit || ''); }
