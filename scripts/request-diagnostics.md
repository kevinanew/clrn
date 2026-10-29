# Issue #63 请求失败诊断

本轮固定基线及初始 HEAD 为 `74a72bee2dd0ef53610ab04560ccd3a69108125f`。
初始工作树干净，没有合并现场或冲突。本仓库没有 `AGENTS.md`、`AGENTS.txt`、
`DEVELOPMENT.md` 或 `.codegraph/`；已读取根目录、visual、e2e 及代理 README，
账号检查、Release 准备、视觉、动画、功能、交互及 E2E 工作流，按目标仓库约定执行。
没有修改项目的分支、索引、Git 配置或历史。

用户指定的 `resolution-findings/63`、三份维护探针缓存、master 复盘缓存及
`investigation/master-74a72bee-texas-social/evidence-summary.json` 在本轮工作区及指定路径均不存在。
本轮未读取远端任务附件、截图或录像，未据旧报告判断当前 CI 成败。

直接读取固定基线源码并在隔离边界运行的探针证实：

- `requestErrorSummary` 会原样保留合成保留域名与 Bearer 凭据；截取首行不能脱敏。
- 账号准备 HTTP 500 保留了数字，但没有操作及私有来源标识。
- 建房辅助函数的非 JSON 分支拼接响应 URL，业务失败分支拼接 reason/errors，
  两个分支都能输出注入的合成地址及凭据。此探针替换了 UI/网络依赖，属于源码回归，
  不代表真实建房、真实浏览器或设备运行。它证明潜在传播缺口，不证明历史上已发生泄露。

## 错误契约

`request-failure.cjs` 的固定操作表是阶段和方法的唯一来源。
账号登录、设币、回读、房屋/房间准备、余额、补钻、建房/删房、观察者连接、账户校验、
续时及个人排行榜读取均使用固定 operation。未知操作及原因不直接复制输入。

示例：

```text
准备账号登录失败：method=POST operation=prepare-account-login source=laiwan_prd status=500 response=received reason=http-error
准备账号登录失败：method=POST operation=prepare-account-login source=laiwan_prd status=unavailable response=not-received reason=timeout
```

HTTP 非成功响应优先报告实际状态，不再读取或拼接错误页。
解析、正文读取、业务拒绝及结果契约错误保留已收到的 HTTP 状态。
没有响应时使用 `unavailable`，不从原始错误消息、cause 或服务端文字推测 500/503。
本地缓存读取用 `method=LOCAL`，并不声称发出过 HTTP 请求。

原始消息、堆栈、cause、请求头、请求正文、任意响应头、后端 reason/errors 均不复制到新错误。
底层异常仅映射到有限原因，cause 遍历有深度和循环保护。
诊断出口只接受本进程构造过的完整请求摘要和有限网络原因；上层包装可以恢复安全错误定位，
包装层的任意文本不保存。JSON、Markdown、终端及 Playwright 附件共用这一边界。
路径脱敏由 #70/PR #76 原任务负责，本轮没有重复修改路径策略。
新增浏览器静态资源事件只使用逻辑操作，不收集其资源路径或查询。

## Release 与代理关联

本轮静态服务生成随机 server/request ID，记录收到请求、文件流结束/错误、响应 finish、
close/中断，输出真实方法与已发送状态。Node 的默认 200 在响应头发送前不算真实状态。
响应中附带 `X-Clrn-Release-Request`；不改变响应正文、成功条件、断流处理或重试。

代理只在本地按协议、主机和端口核对本轮 Release 来源，公开输出匹配结果。
只有来源精确匹配且响应编号属于本轮 server ID 时才保存该编号，其他标为 `unverified`。
HTTP 同时记录代理客户端/上游连接的随机 ID、请求 ID 以及请求阶段是否已命中 fixture。
这些 ID 及来源验证不代表已查明后端实例或连接故障根因。
未收到响应时无法靠响应头确认服务收到请求；应结合服务器生命周期，保留证据不足状态。

`release-server-events.jsonl` 使用既有上传目录：动画为 `test-results/animations/release-server`，
功能为 `test-results/cases/release-server`，交互及客服分别位于同名结果子目录，其他为
`test-results/release-server`。相对于各套件工作目录，不新增工作流或上传动作。
记录上限为一万条，超出后明确记录截断；Playwright 清理结果目录后可恢复写入。

## 本轮验证及保留边界

所有新增故障输入使用 `.invalid`、保留 IP、回环服务和合成凭据，无真实业务或账号调用。
现有归属、账号分区、UUID、路径、身份、余额、HTTP/业务成功断言及默认透传保持生效。
失败仍退出非零；没有调整基准、阈值、遮罩、超时预算或重试次数。
既有错误文案断言改为核对实际方法、操作、来源、状态和原因，拒绝条件与资源释放检查保留。

- `npm ci` 首次受网络/运行环境影响异常退出；复制只读缓存到临时目录后，离线 `npm ci` 成功。
- ESLint、两份 TypeScript 配置、400 行限制、Ruff 0.15.12、ShellCheck 0.11.0 和
  actionlint 1.7.12 使用已安装固定版本检查通过。
- 最近一次全量 `npm test`：154 项，148 通过、6 失败。
  5 项为本机端口 `EPERM`；另一个 Release 工具测试进程触发 Node 运行时断言崩溃。
  未跳过或放宽这些检查。此后补充结果目录恢复写入、响应状态传播及静态服务就绪错误边界，
  并复测相关单元用例和静态检查。
- Python 共用套件 46 项，45 通过；五入口真实代理集成因监听权限失败。
  其中诊断的 8 项回归全部通过，包含精确来源/端口、连接关联、无响应与合成凭据负例。
- 请求错误回归覆盖三个账号阶段的 HTTP 500、超时、连接失败、无效 JSON、正文读取失败、
  业务拒绝、循环/深层 cause、上层传播、真实 JSON/Markdown 文件、终端及附件。
  同时验证收到 206 后中断仍保留 206，以及未收到响应不能伪造状态。
- 续时和个人排行榜的四项离线浏览器用例在浏览器启动时因 macOS 沙箱权限失败；没有运行通过。
- `npm run check` 与完整 pre-commit 原命令均在 uv 缓存权限处停止，不宣称通过。
  宿主须执行固定三项检查、真实端口与浏览器回归，以及当前提交的独立验收。

本轮可以提交给宿主验证发布，但没有当前提交的完整 CI、真实账号全矩阵或新画面证据。
原生用例收集、离线回归均不能代表真实设备运行。没有修复或推断 master 的素材连接故障，
没有调查暂停的 #65，也没有接管 #68 或 #70。Issue #63 应保留待独立验收状态。
