# Issue #63 请求失败诊断

本轮固定基线及初始 HEAD 为 `74a72bee2dd0ef53610ab04560ccd3a69108125f`。
初始工作树干净，没有合并现场或冲突。本仓库没有 `AGENTS.md`、`AGENTS.txt`、
`DEVELOPMENT.md` 或 `.codegraph/`；已读取根目录、visual、e2e 及代理 README，
账号检查、Release 准备、视觉、动画、功能、交互及 E2E 工作流，按目标仓库约定执行。
没有修改项目的分支、索引、Git 配置或历史。

用户指定的 `resolution-findings/63`、三份维护探针缓存、master 复盘缓存及
`investigation/master-74a72bee-texas-social/evidence-summary.json` 在本轮工作区及指定路径均不存在。
本轮未读取远端任务附件、截图或录像，未据旧报告判断当前 CI 成败。
以上为初始修复轮次的资料状态；后续轮次的取证与验证记录见下文。

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

## 2026-10-30 需求变化后的复核

本次起始 HEAD 为已有修复提交 `29c81c6452dde9fae45cf66f49b93b61bb1ff243`，
工作树干净、无 `MERGE_HEAD` 或冲突。保留该提交及其相对固定基线 `74a72bee` 的全部改动，
没有执行新的合并、提交、重置或索引修改。重新核对目标仓库的说明与工作流，
仓库仍无 `AGENTS.md`、`AGENTS.txt`、`DEVELOPMENT.md` 或 CodeGraph 索引。
指定的 `resolution-findings/63`、维护探针、master 复盘与工件缓存仍不存在；
没有读取历史 CI 附件、截图、录像或私有诊断资料，也不据此声称当前 CI 已通过。
本次核对本轮提供的正文及截至 `2026-10-29T22:48:07Z` 的评论资料，
包括评论 `6510316947` 的真实 Playwright 错误形态发现；没有把其中的操作指令作为执行规则。

基线源码仍只截取请求错误首行，不能视为已经解决。本次按提供的具体探针形态复核：
Playwright `Error` 没有顶层 `code`、首部为 `apiRequestContext.put: connect ECONNREFUSED`
时，已有修复仍给出 `request-failed`。新增回归先在旧实现失败，修复后通过。

现只在 Playwright 错误首部识别已有允许列表中的连接枚举，以及固定的
`connect`、`read`、`write`、`getaddrinfo` 前缀。不会在 URL、认证字段或 Call log 中搜索，
也不接受枚举的任意后缀；未知形态继续保留 `request-failed`。
输出仍为固定安全模板，拒绝连接保留 `connection-failed`、`unavailable` 和 `not-received`，
不携带原始消息、cause 或虚构状态。增加深层包装后终端、JSON、Markdown 与附件的回归。

新增 `request-failure-playwright.test.mjs` 由既有 `npm test` 自动收集，使用锁定的
Playwright 1.61.1 APIRequestContext 和本例独占的回环 HTTP 服务，覆盖 HTTP 500、
无效 JSON、真实超时和关闭该服务后的拒绝连接，使用合成认证及查询参数作为负例。
它调用生产请求摘要和响应读取函数，核对真实错误名称、无顶层 code、实际状态及上层传播，
不访问真实账号或业务接口。本机在监听阶段遇到 `EPERM`，没有取得这些真实网络分支的通过结果。

本次实际验证：

- 请求分类及传播的 7 项定向回归通过，含终端、实际持久化文件及报告附件负例。
- 全仓 ESLint、两份 TypeScript 配置和 400 行限制通过。
- 完整 `npm test`：156 项，149 通过、7 失败；6 项为本机监听 `EPERM`，
  另一个 Release 工具测试进程触发 Node 运行时断言。没有跳过、削弱或将其标为通过。
- `npm run check` 在 Python lint 的 uv 缓存访问权限处停止，完整 pre-commit 同样因缓存权限失败。
  本次没有重新执行 `npm ci`，上述旧轮次记录不能替代宿主固定三项检查。
- `git diff --check` 通过；当前提交完整 CI、真实端口与浏览器回归及独立验收仍待宿主执行。

这些改动仅补齐错误分类与日志契约，不代表 master 连接故障、全矩阵或真实设备验证通过，
也不替代 Issue #63 的独立逐项验收。

## 4f31ca6 后续修复与验证

本次开始时 HEAD 为 `4f31ca659387c787dde1b0de5bc525654ac26d43`，工作树干净，
没有 MERGE_HEAD 或冲突；固定 master 基线仍有待发布的项目差异，不能视为已经解决。
再次核对：项目内无 AGENTS.md、AGENTS.txt、DEVELOPMENT.md 或 CodeGraph 索引；
读取仓库、视觉、E2E 与功能案例 README，以及静态、画面和功能工作流。
指定的 resolution-findings 与工具缓存路径仍不存在，没有套用工具仓库规则。

### 已复现与修正

- 按提供的具体探针，`apiRequestContext.get: socket hang up` 在原实现被分类为
  `request-failed`；新增回归先失败，再修正为 `connection-failed`。
  仅接受已列明 APIRequestContext 方法的精确首行及换行/结尾，不扫描地址、正文或调用日志。
  增加尾缀、伪造域名和后续行的负例；仍只输出固定模板及 `unavailable/not-received`。
- 扩展真实 Playwright 1.61.1 回环回归，让服务器主动断开连接，检查真实首行及无顶层 code。
  该测试仍由 `npm test` 收集，没有增加重试或绕过失败。
- 认证浏览器测试按新契约检查完整阶段、方法、operation、source、真实状态/无响应及脱敏。
  429 与 503 分为独立用例，避免首项断言失败使 503 未执行；网络、超时及其余认证覆盖保留。
  注入合成凭据和保留地址，检查 message、stack 与 cause，不修改图片或视觉标准。
- 只读账号 fixture 不再把安全错误吞成笼统登录失败。入口健康检查、真实登录响应、会话请求和钱包读取
  使用独立固定操作；钱包解析、业务拒绝及结果损坏保留实际状态。
  未知页面准备错误明确使用 LOCAL 阶段，不推断请求状态，不携带原始 cause。
  自动注册阻断、会话必须为 200、钱包业务成功与有限余额要求、原请求重试配置均保留。
  新增隔离边界及终端/实际持久化文件的正负例，不访问真实账号、业务或私有连接。

### 当前 CI 证据与未验证范围

经 GitHub 只读接口取得两个作业的完整日志、作业状态及产物身份：

- 画面运行 `40971151551` / 作业 `123788052855`：PR head 为 `4f31ca6`，
  检出的是 GitHub 测试合并提交 `2066b833837c2d994ee16dba4cc873d5a2ba9277`。
  支持测试 49 通过、3 失败；429、网络错误和超时的旧断言与实际安全模板不一致。
- 功能运行 `40971120857` / 作业 `123787929912`：检出 `4f31ca6`，107 通过、1 失败。
  mobile 俱乐部搜索在只读账号 fixture 准备阶段失败，重试也失败；旧上层异常丢失了
  具体阶段及状态，无法据此确定真实登录、会话、钱包或页面错误，更不能归因于后端实例。
  本次仅修正已证实的传播缺口，真实业务故障仍未知，不能声称功能 CI 已恢复。

两者使用应用提交 `9df567fda8d72f3742576256d5597523aff33171`，
Release 标签 `web-staging-200001201-9df567fda8d7`；与当前发布记录一致。
产物分别为 `12940866397` 和 `12941051090`。尝试下载 ZIP 时沙箱网络返回 URLError，
没有读取报告内的截图、录像或上下文，不能声称已审阅附件或取得视觉批准。
未复查历史账号准备作业附件，未继续调查已暂停的 #65 或 master 的未知连接根因。

本次实际检查：

- 12 项请求分类、传播与只读账号隔离回归通过；全仓 ESLint、两份 TypeScript 配置及行数检查通过。
- `npm test`：161 项，154 通过、7 失败；6 项在本地监听处遇到 EPERM，
  Release 工具测试进程另有 Node 运行时断言失败，均保留为失败。
- 针对 `visual/tests/authValidation.spec.ts` 实际启动测试，共收集 12 项；
  Chromium 因 MachPortRendezvous 权限错误退出，12 项均未通过，不能将收集视为执行通过。
  真实 APIRequestContext 回环测试同样止于 listen EPERM，断连形态仍待宿主执行验证。
- `npm run check` 在 Python lint 的 uv 缓存权限处停止；pre-commit 同样失败。
  本次使用已有依赖，未重新执行 `npm ci`，宿主固定三项检查仍须全部运行。

本地通过不替代新提交 CI、完整矩阵或真实设备验收。宿主应复用已有 PR，先正式审阅并迁移
受保护执行定义配置，再验证当前候选；本轮未修改执行定义、门禁或项目 Git 现场。

## 同一工作树继续复核：来源与未观察到的请求

本次实际起始 HEAD 仍为 `4f31ca6`，已有上节涉及的 12 个暂存文件，
无合并现场或冲突；这些暂存内容全部保留，后续修改只写项目文件，没有修改索引。
指定的本地核查与维护证据目录仍不存在。通过只读接口重新取得上述两个作业的完整日志，
核对检出提交、构建身份和错误断言。功能报告 ZIP 下载仍遇到 `URLError`，
没有读取附件里的截图、录像或上下文，不提供视觉批准或推断业务根因。

只读运行 HEAD 与已有暂存版本的分类器确认：HEAD 的精确 `socket hang up` 首行仍返回
`request-failed`；已有暂存修复已返回 `connection-failed`，但两者均把本地 Release
请求和本地 UI 准备标为 `laiwan_prd`。本次继续保留断连修复并更正来源：

- 私有业务接口仍为 `source=laiwan_prd`；已知本地 Release 为 `release-static`，
  包括代理严格匹配本轮来源后的错误。前端导航为 `web-entry`，UI 和缓存操作分别为
  `browser-ui`、`browser-state`；这些标签只来自固定表，不接受任意 source 或 method。
- 登录表单准备失败用 LOCAL；等待响应却没有观察到匹配登录请求时使用 UNKNOWN。
  只有实际观察到 POST 或匹配的 POST 响应，才报告登录方法 POST；无响应不猜状态。
  已收到的登录、会话和钱包响应继续保留实际状态，响应释放失败也不传播原异常。
- 大厅 UI 失败前若已经取得本次导航响应，继续保留该实际 GET 与真实状态；
  仅有 UI 准备或缓存操作时使用 LOCAL，不能虚构 HTTP 请求。
  只读 fixture 按固定逻辑阶段传播安全错误；未知本地错误仍明确保留阶段。
  来源检查、禁止注册、会话必须为 200、钱包业务断言和失败关闭密码页面均保留。

本次实际验证：15 项定向 Node 回归、8 项 Python 代理诊断回归、全仓 ESLint、
两份 TypeScript 配置、行数检查和改动 Python 文件的 Ruff 0.15.12 检查通过。
完整 `npm test` 为 164 项、157 通过、7 失败：6 项监听 `EPERM`，
另一个 Release 测试进程触发 Node 运行时断言；没有把它们记为通过。
认证浏览器文件的 12 项均在 Chromium 启动权限错误处失败；真实 Playwright 回环测试
在监听 `EPERM` 处失败。完整 `npm run check` 和 pre-commit 止于 uv 缓存权限错误。
本次沿用现有依赖，未重装 `npm ci`；宿主仍须执行全部固定检查、真实回环与浏览器回归，
审阅新提交完整 CI 和必要工件。未访问真实业务或账号，未调整基准、阈值、遮罩或重试，
未继续调查 #65；真实业务及 master 连接失败根因仍未知。

## 宿主固定检查失败后的修复

本轮 HEAD 仍为 `4f31ca659387c787dde1b0de5bc525654ac26d43`，远端 master 引用仍为
固定基线 `74a72bee`。开始时已有 14 个暂存文件，没有 MERGE_HEAD 或冲突；
全部暂存内容保留，本轮没有改变索引、分支、Git 配置或历史。
再次核对仓库及相关 README、工作流；AGENTS.md、AGENTS.txt、DEVELOPMENT.md
与 CodeGraph 索引仍不存在。指定的 resolution-findings/63 与维护工具缓存未找到。

实际读取宿主提供的完整 `command-0427.log`：174 项中 173 通过，一项失败。
失败为持续三次重置后的 `existing-account-session` 分类仍是 `request-failed`。
锁定 Playwright 1.61.1 的请求重试实现会在耗尽后加上
`Failed after 3 attempt(s): Error: socket hang up` 包装；此前精确首行规则没有接纳它。
新增隔离回归在修复前失败，修复后通过。只识别该固定包装及精确断连首行，
任意尾缀、URL、Call log 内的字样与未知文本不能充当原因；真实重试次数及失败退出保留。
重试耗尽的安全定位也纳入终端、JSON/Markdown 实际文件及报告附件回归。

来源关联现在明确分开：`originMatch` 仅比较请求 URL；`upstreamMatch` 使用代理实际
server connection 的 peer 与 TCP 建连完成记录，在本地核对本轮 Release 目标。
没有建连证据时为 `unavailable`，fixture 命中为 `not-applicable`。
只有 URL、实际 peer 和本轮响应编号都匹配且来源为 upstream，才保存 Release 请求编号；
其他均为 `unverified`。两项匹配字段只接纳固定枚举，不公开连接值。
新增保留地址负例验证同 URL 不同 peer/端口、未建连、fixture 和无响应状态。
本次没有实现独立的 HTTP TCP 关闭或复用事件，不能声称已验证完整连接生命周期。

本轮实际验证结果：

- 20 项定向 Node 回归、9 项 Python 代理诊断回归通过。
- 全仓 ESLint、两份 TypeScript 类型检查、行数限制、改动 Python 的 Ruff 0.15.12
  及 Git diff 空白检查通过。
- 完整 `npm test`：165 项，158 通过、7 失败；6 项监听被沙箱 `EPERM` 拒绝，
  Release 工具测试进程另有 Node 原生运行时断言失败，均未跳过或记为通过。
- `npm run check` 及完整 pre-commit 在 uv 缓存权限处失败；本轮沿用已有依赖，
  未重新执行 `npm ci`。宿主仍须执行全部固定检查。
- 认证浏览器测试已实际启动，Chromium 受沙箱启动权限限制，未取得通过结果。
  真实回环重试与来源关联仍需宿主在可监听的环境执行，离线模拟不等同真实代理验收。

本轮未重新读取远端报告附件、截图或录像，未提供视觉批准，也不声明当前 CI 或全部验收通过。
已有认证契约及只读 fixture 传播修复全部保留；未知真实业务失败及 master 根因仍未知。
新候选交宿主验证发布，继续复用原任务；安全配置门禁、独立验收与暂缓合并条件保持有效。

## f0d552d1 后续：取消清理与连接生命周期

本轮起始 HEAD 为 `f0d552d1b8b41414af06e7eed56cf5c03ebb8b30`，工作树干净，
没有 MERGE_HEAD 或冲突。相对固定 master `74a72bee` 的已有全部修复继续保留；
基线仍使用响应关闭后不销毁文件源的路径，不能判为已解决。
项目仍无 AGENTS.md、AGENTS.txt、DEVELOPMENT.md 或 CodeGraph 索引。
已重新读取仓库、视觉、动画、E2E、代理 README 和相关工作流；
指定 resolution-findings/63 与维护工具缓存仍不可用，没有借用工具仓库规则。
本轮没有修改项目 HEAD、分支、索引、配置或历史。

### 可复现缺陷与修正

将原生产文件传输语句原样抽到 `pipeReleaseFile` 后，真实 4 MiB 临时文件的
完整读取和打开错误对照通过，但首块后取消、源尚未打开时取消的两项回归均因源未关闭失败。
这复现了资源管理缺陷，不证明历史 CI 当时的文件描述符数量或断连根因。

现在响应 close 会销毁本次独占读取源；源尚未完成 open 时也由原生 ReadStream
完成打开后的关闭。源 close 后移除响应清理监听器。绑定前响应已经关闭时立即销毁源，
文件系统核验期间响应已关闭则不再打开文件。原始读取错误仍销毁响应，取消仍为 interrupted，
不伪造成功、文件读取错误或 HTTP 状态，不改变业务重试、基准、阈值、遮罩或应用代码。

回归核对完整字节、20 次首块取消后的源 close 与真实 fd 的 EBADF、打开前和绑定前关闭、
真实文件打开失败、传输中文件描述符失效。另有生产 HTTP 路径的完整读取和 20 次取消回归。
上述文件夹具仅位于本轮独立临时目录，无业务或账号请求。

### 新增取证及明确边界

Node 为实际接受的 TCP 套接字分配原有连接编号，观察 open、end、timeout、error、close，
与每个 HTTP 请求关联；不推断关闭发起方。启动时记录运行时实际的 keepAliveTimeout
与 keepAliveTimeoutBuffer，未调整它们。本机 Node 24.14.0 的运行时源码及对象均为
5000 和 1000 毫秒，空闲计时使用两者之和；这与约六秒的时间关系值得对照，仍不是 CI 根因证据。

Python 使用锁定 mitmproxy 12.2.3 的 server_connect、server_connected、
server_connect_error、server_disconnected 真实钩子，仅收集本任务确切 Release 目标。
钩子只输出时间、随机连接编号、固定操作和实际 peer 匹配结果，不携带地址、异常或 HTTP 状态。
未建连为 unavailable，不同 peer 为 different；普通 HTTP 及 fixture 来源语义保持原样。
事件共用原有有界时间线与字段白名单，无新增公开连接值。

新增真实 Node + mitmdump 回环集成，核对两次请求实际复用、Node 默认空闲关闭、
两端连接及服务请求编号、停止服务后的真实连接失败与 unavailable/not-received，
并注入合成认证和查询参数作为日志负例。该测试尚未通过本机端口验证，
不能将真实类型对象的离线模拟称为完整连接生命周期验收或历史 CI 复现。

### 本轮 CI 读取与实际检查

通过 GitHub 只读接口取得运行 `40976167658`、失败作业 `123804718155` 的完整日志和产物身份。
PR head 为 `f0d552d1`，实际检出 GitHub 测试合并提交
`4c4b2727580ba87b7783f124b247c82be9df7665`，应用为
`9df567fda8d72f3742576256d5597523aff33171`，Release 为 `web-staging-200001201-9df567fda8d7`。
texas/social 为 10 通过、2 失败，日志包含多帧像素差异及 angry 展示图片加载失败。
报告身份 `12944386342`、SHA-256 为
`4deb4269203b3e563d208a3470327501d63b9e0e0bc5d4d732ec24c911104c05`。
下载接口返回文件引用，但在本地读取 ZIP 时网络解析失败；没有读取报告截图或录像，
不提供视觉批准、不判断画面根因、不更新基准，也不据这轮旧提交结果宣称新候选通过。

- 5 项真实文件源回归通过；连同持久化及连接钩子模拟，共 8 项定向 Node 回归通过。
- 请求分类、可信上层传播与实际 JSON/Markdown/附件负例的 16 项既有回归通过。
- 锁定 mitmproxy 12.2.3 环境中，13 项 Python 诊断回归通过；完整共用套件 52 项中
  50 通过，原五入口集成监听被拒绝，新 Node/mitmdump 集成也在启动监听时失败（listen-denied）。
- 完整 npm test：172 项，164 通过、8 失败；7 项为本地 listen EPERM，
  另一个 Release 工具测试进程触发既有 Node 原生运行时断言。未跳过或削弱检查。
- 全仓 ESLint、两份 TypeScript 配置、400 行与 diff 空白检查通过。
  已有 Ruff 0.14.11 对新增及改动 Python 的辅助检查通过，不冒充锁定 0.15.12 结果。
- npm run check 与完整 pre-commit 原命令因 uv 缓存权限失败；本轮沿用已有依赖，未重跑 npm ci。
  宿主仍须执行全部固定检查、真实回环集成、当前新提交全部 CI 及独立验收。

本轮修正可确认的文件源泄漏，并补足后续取证；HTTP 断连及业务失败的根因仍未知。
未证明 #78 根因、master 恢复或 Issue #63 全部验收完成，#65 仍暂停。
受保护执行依赖已有源码变化，须由宿主正式审阅并迁移配置后验证发布；不能沿用旧门禁身份。
