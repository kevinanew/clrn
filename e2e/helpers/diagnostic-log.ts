/** 在 Playwright 清理目录之外持续保存脱敏副本，保留每次命令和重试的独立身份。 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { diagnosticFullText } from './diagnostic-privacy';

/**
 * 清理自由文本中的凭据、正文和连接资料；绝不读取 console 参数对象或真实请求正文。
 * @param value - 浏览器或测试运行器输出。
 */
export function logText(value: unknown): string {
  let text = String(value ?? '');
  for (const [key, secret] of Object.entries(process.env)) {
    if (/(?:password|token|secret|cookie|authorization)/i.test(key) && secret && secret.length >= 4) {
      text = text.split(secret).join('[已隐藏]');
    }
  }
  // 自由文本中的对象/数组可能是完整请求正文；不展开、不猜测其中哪些字段安全。
  text = text.replace(/\{[\s\S]*/, '[结构化内容已隐藏]')
    .replace(/\[\s*(?=["'[{0-9-]|true\b|false\b|null\b)[\s\S]*/, '[结构化内容已隐藏]');
  text = text.replace(/((?:["']?(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|access[_-]?token|refresh[_-]?token|token|secret|body|data|payload|headers|requestBody|responseBody)["']?)\s*[:=])[\s\S]*/gi, '$1[已隐藏]')
    .replace(/\b(?:Basic|Bearer)\s+[^\s,"'}]+/gi, '[认证已隐藏]');
  text = text.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[认证已隐藏]');
  return diagnosticFullText(text);
}

/** 按完整输出行脱敏，避免凭据跨 stdout/stderr 数据块时被拆开泄露。 */
export class DiagnosticOutput {
  private pending = '';
  private discarded = 0;
  private depth = 0;
  private quote = '';
  private escaped = false;

  /**
   * 为一个输出流创建独立缓冲，避免 stdout 和 stderr 交错拼接。
   * @param log - 当前来源的持久化日志。
   * @param event - 固定输出事件。
   */
  constructor(private readonly log: DiagnosticLog, private readonly event: string) {}

  /**
   * 完整行立即脱敏落盘，超长行整体丢弃并明确记录字符数。
   * @param chunk - 原始输出块。
   */
  write(chunk: string | Buffer): void {
    const lines = String(chunk).split('\n');
    lines.forEach(/** 合并同一行的分块，不保留任意长的敏感输出。
     * @param line - 当前行片段。
     * @param index - 分块内行号。
     */ (line, index) => {
      this.pending += line;
      if (this.pending.length > 65536 || this.discarded) {
        this.discarded += this.pending.length;
        this.pending = '';
      }
      if (index < lines.length - 1) this.flush();
    });
  }

  /** 正常退出时保留没有换行的最后输出；强制终止时未完成行可能无法取得。 */
  flush(): void {
    if (this.discarded) this.log.record('collection.output-line-dropped', { droppedCharacters: this.discarded });
    else if (this.pending) {
      const continuation = this.depth > 0;
      const start = continuation ? 0 : this.pending.search(/\{|\[\s*(?=["'[{0-9-]|true\b|false\b|null\b)/);
      if (start >= 0) for (const character of this.pending.slice(start)) this.observeStructure(character);
      this.log.record(this.event, { text: continuation ? '[结构化续行已隐藏]' : logText(this.pending) });
    }
    this.pending = '';
    this.discarded = 0;
  }

  /**
   * 结构化输出跨行时仍隐藏全部正文，字符串内的括号不能提前结束隐藏。
   * @param character - 当前原始字符，仅用于判断结构，不写入日志。
   */
  private observeStructure(character: string): void {
    if (this.escaped) { this.escaped = false; return; }
    if (this.quote) { this.observeQuoted(character); return; }
    if ('"\'`'.includes(character) && this.depth) this.quote = character;
    else if ('[{'.includes(character)) this.depth++;
    else if (']}'.includes(character)) this.depth = Math.max(0, this.depth - 1);
  }

  /**
   * 字符串转义状态只在当前结构内部保留。
   * @param character - 结构中的字符串字符。
   */
  private observeQuoted(character: string): void {
    if (character === '\\') this.escaped = true;
    else if (character === this.quote) this.quote = '';
  }
}

/**
 * 从异常中只提取固定错误类型和代码，保留网络错误而不扫描私有地址中的数字。
 * @param error - 原始异常或浏览器固定错误文本。
 */
export function logError(error: unknown): Record<string, string> {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error ?? '');
  const code = message.match(/\b(?:net::ERR_[A-Z_]+|E(?:CONNRESET|CONNREFUSED|TIMEDOUT|NOTFOUND|AI_AGAIN)|UND_ERR_[A-Z_]+)\b/)?.[0];
  return { errorName: /^(?:Error|TypeError|ReferenceError|SyntaxError|RangeError|TimeoutError|AbortError)$/.test(name) ? name : 'Error',
    code: code ?? 'unavailable', text: logText(message) };
}

/** 返回 reporter 提前传给 worker 的独立命令目录；本地无 reporter 时仍持续落盘。 */
export function diagnosticDirectory(): string {
  return process.env.CLRN_DIAGNOSTIC_SESSION || path.resolve(__dirname, '../../.ci-diagnostics/local');
}

/**
 * 不在路径中暴露用例参数，重试、重复、设备和 worker 之间不会覆盖。
 * @param info - 测试运行器提供的标识。
 */
export function diagnosticCaseDirectory(info: { testId: string; retry: number; repeatEachIndex?: number; workerIndex: number }): string {
  const id = createHash('sha256').update(info.testId).digest('hex').slice(0, 16);
  return path.join(diagnosticDirectory(), `${id}-repeat-${info.repeatEachIndex ?? 0}-retry-${info.retry}-worker-${info.workerIndex}`);
}

/** 同步追加确保失败前事件已经落盘；容量满后保留开头并在清单记录准确丢弃量。 */
export class DiagnosticLog {
  private bytes = 0;
  private events = 0;
  private dropped = 0;
  private droppedBytes = 0;
  private truncatedCharacters = 0;
  private firstAt = Date.now();
  private lastRetainedAt?: number;
  private unavailable = false;

  /**
   * 创建一个有明确容量和保留策略的日志源。
   * @param directory - 本次命令或用例目录。
   * @param source - 固定来源名称。
   * @param limit - 每源最大字节数，默认 8 MiB。
   */
  constructor(readonly directory: string, readonly source: string, private readonly limit = 8 * 1024 * 1024) {
    this.record('collection.start', { retention: 'first-events', limit });
  }

  /**
   * IO 失败只标记诊断不可用，避免覆盖原始测试或业务错误。
   * @param write - 当前持久化操作。
   */
  private persist(write: () => void): void {
    if (this.unavailable) return;
    try { mkdirSync(this.directory, { recursive: true }); write(); }
    catch {
      this.unavailable = true;
      process.stderr.write('Web diagnostics: collection.unavailable (storage-write-failed)\n');
    }
  }

  /**
   * 保存仅包含安全字段的身份/状态文件。
   * @param name - 固定文件名。
   * @param value - 已清理元数据。
   */
  save(name: string, value: unknown): void {
    this.persist(/** 写入当前安全元数据。 */ () => writeFileSync(path.join(this.directory, name), JSON.stringify(value, null, 2)));
  }

  /**
   * 调用方只传固定字段和经过日志脱敏器清理的文本，禁止传入请求/响应对象。
   * @param event - 固定事件名称。
   * @param fields - 安全字段副本。
   */
  record(event: string, fields: Record<string, unknown> = {}): void {
    this.persist(/** 使用同步追加，在调用返回前保存当前事件。 */ () => this.append(event, fields));
  }

  /**
   * 统计每条事件及清单，写入失败由统一边界处理。
   * @param event - 固定事件名。
   * @param fields - 安全字段。
   */
  private append(event: string, fields: Record<string, unknown>): void {
    const observedAt = Date.now();
    const line = JSON.stringify({ ...fields, event, observedAt, source: this.source },
      /** 所有文本字段有相同上限，并准确累计脱敏副本丢弃的字符数。
       * @param _key - 序列化字段。
       * @param value - 已清理的字段值。
       */ (_key, value) => {
        if (typeof value !== 'string') return value;
        this.truncatedCharacters += Math.max(0, value.length - 2000);
        return value.slice(0, 2000);
      }) + '\n';
    const size = Buffer.byteLength(line);
    if (!this.dropped && this.bytes + size <= this.limit) {
      appendFileSync(path.join(this.directory, `${this.source}.jsonl`), line);
      this.bytes += size;
      this.events++;
      this.lastRetainedAt = observedAt;
    } else {
      this.dropped++;
      this.droppedBytes += size;
    }
    writeFileSync(path.join(this.directory, `${this.source}-manifest.json`), JSON.stringify({
      source: this.source, events: this.events, bytes: this.bytes, limit: this.limit,
      dropped: this.dropped, droppedBytes: this.droppedBytes, retention: 'first-events',
      firstAt: this.firstAt, lastRetainedAt: this.lastRetainedAt, lastObservedAt: observedAt,
      truncatedCharacters: this.truncatedCharacters,
      textLimit: 2000, textTruncation: '每条文本保留脱敏后的前 2000 字符',
    }, null, 2));
  }
}
