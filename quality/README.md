# 静态质量门禁（#69）

在仓库根目录安装 Node.js 24 和 uv，执行 `npm ci`。统一只读入口是 `npm run lint`；
`npm run check` 继续包含两份 TypeScript 类型检查和全部 Node 单元测试。
既有 pre-commit 的 `npm run lint` 自动包含新门禁，没有新增 hook 安装流程。
CI 的 `lint.yml` 在 push、PR 和手动触发时使用相同 pre-commit 入口，再运行原有单元测试。
其他浏览器、Python、设备和真实业务工作流保持原有验收，不由此处替代。

| 命令 | 工具与失败条件 |
| --- | --- |
| `npm run lint:js` | ESLint 10.12.0：complexity classic > 10、max-depth > 3、TS 网络响应入口，以及全部既有规则；警告同样失败 |
| `npm run lint:python` | 先执行 Python 500 物理行硬门禁，再执行 Ruff 0.15.12：原有规则及 C901 > 10；独立强制 C901 扫描不接受 noqa、配置忽略或阈值放宽 |
| `npm run lint:python:lines` | 独立只读扫描 Python 文件；超过 500 物理行、读取失败、Git 缺失或空扫描均失败 |
| `npm run lint:architecture` | dependency-cruiser 18.7.0：循环（包含类型导入）、直接或间接越层、本地导入无法解析 |
| `npm run lint:duplication` | jscpd 5.4.2：至少 5 行、70 词元、mild 模式；不使用总百分比容忍新增重复 |
| `npm run --silent quality:report` | 输出全部实测诊断、依赖图和无源码片段的重复位置 JSON；用于测量，不代表门禁通过 |

工具版本与 npm 传递依赖锁定在 `package.json`、`package-lock.json`；TypeScript 为 5.9.3。
初次测量使用 Node 24.14.0、uv 0.11.32。最终采用复杂度 10、嵌套 3，原因是实测已有超限，
但可用精确清单迁移，无需提高阈值或为了指标立即改写账号、诊断和动画控制流。
静态检查不启动应用、设备、代理或真实业务请求；jscpd 报告和基线副本只写系统临时目录并清理。

## Python 文件长度（#111）

`npm run lint:python:lines` 可独立执行，不需要安装 Python 包；也可直接运行
`node scripts/python-lines.mjs`。`npm run lint:python`、`npm run lint`、pre-commit 的 lint hook
和 `lint.yml` / `account-tools.yml` 的 pre-commit 步骤沿同一调用链阻断超长文件。

扫描复用 `scripts/source-files.mjs`：Git 已跟踪文件和未忽略的新 `.py` 文件均覆盖，
包含普通源码、代理、测试、fixture 和工具，支持嵌套目录及特殊文件名；删除文件正常跳过。
沿用 Git 忽略规则和既有依赖、产物目录排除：`node_modules`、`.venv`、`test-results`、
`playwright-report`、`blob-report`、`snapshots`、`.ttyctl`，不新增文件豁免或历史额度。
空行、注释与 docstring 全部计入；空文件为 0 行，支持 LF、CRLF、CR 和没有末尾换行的文件。
输出扫描文件数、最长文件及每个超限文件的实际行数与 500 行上限，超限时非零退出。

实施前在 `4e15d4d` 重新扫描：46 个适用 Python 文件，最长
`e2e/mitmproxy/scenario_fixtures.py` 为 367 行，全部通过，无需拆分源码。
这是实施前实测；当前代码应以重新执行扫描命令的输出为准。

`node --test scripts/python-lines.test.mjs` 用临时 Git 仓库验证 500/501、换行、空文件、
新文件、删除文件、嵌套及排除目录、读取失败、Git 缺失和空扫描，并验证实际 npm 静态入口阻断。
`scripts/verify-pre-commit.py` 另通过真实 `git commit` 验证 500 行可提交、501 行被 hook 拦截。

## 最新代码的初始测量

固定源码：`347b50a` 的完整 revision 以 [measurement.json](measurement.json) 为准。
该文件是实施前 `git archive` 导出的独立源码副本测量，未把本次新增检查器计入初始统计。

| 项目 | 初始结果 |
| --- | --- |
| JS/TS | 296 个文件；46 处 complexity > 10，最大 51；20 处 max-depth > 3，最大 6 |
| Python | 41 个文件；15 个函数 C901 > 10，最大 32 |
| TS 网络响应入口 | 98 个语法位置；包括直接路由、响应生成、fetch 替换及恢复、HTTP 服务器；不等同于 98 处业务 Mock |
| 依赖图 | 317 个模块、1064 条依赖（含类型导入）；循环和分层规则均为 0 违规 |
| 重复 | 43 组、618 行，占 29732 扫描行的约 2.08% |

[baseline.json](baseline.json) 保存逐位置的 ESLint/Ruff 诊断、源码行 SHA-256、原始位置、分类与原因。
[measurement.json](measurement.json) 保存版本、阈值、汇总及全部重复位置和迁移理由；不存源码片段。
[jscpd-baseline.json](jscpd-baseline.json) 使用工具原生的内容指纹和出现次数。
代码行数仍只是既有辅助门禁，不能证明代码无用；测量也不能代替运行时根因分析。

复现当前代码：`npm run --silent quality:report > /tmp/clrn-quality.json`。
复现初始源码时，在另一个临时目录导出该 revision，使用本分支已安装的固定工具和配置：

```sh
tools="$PWD"
snapshot="$(mktemp -d)"
reports="$(mktemp -d)"
revision="$(node -p "require('./quality/measurement.json').revision")"
git archive "$revision" | tar -x -C "$snapshot"
ln -s "$tools/node_modules" "$snapshot/node_modules"
cd "$snapshot"
# ESLint/Ruff 退出 1 表示测量发现违规，不能记作通过。
node "$tools/node_modules/eslint/bin/eslint.js" -c "$tools/eslint.config.mjs" . -f json > "$reports/eslint.json"
uvx --from ruff==0.15.12 ruff check --no-cache --isolated --ignore-noqa --select C901 \
  --config 'lint.mccabe.max-complexity=10' --output-format json . > "$reports/ruff.json"
node "$tools/node_modules/dependency-cruiser/bin/dependency-cruiser.mjs" \
  -c "$tools/.dependency-cruiser.cjs" -T json e2e visual scripts eslint.config.mjs lint-lines.mjs > "$reports/dependencies.json"
node "$tools/node_modules/jscpd/run-jscpd.js" . -c "$tools/.jscpd.json" \
  --baseline "$tools/quality/jscpd-baseline.json" --output "$reports" --silent
```

原始本地工具报告可能包含源码；只将审查过且不含敏感信息的逐位置摘要纳入仓库。
私有来源始终只用 `laiwan_prd` 指代，不将其连接、部署或凭据信息复制到代码、清单或日志。

## 网络边界与例外

所有 TS 源文件（包含普通视觉/集成测试、辅助函数、`.test.ts` 和 `.browser.ts`）使用同一规则，
不豁免整个测试目录。规则检查 AST，不匹配注释、普通字符串或 JSON 数据。
它覆盖 `route`、`fulfill`、HAR、WebSocket 路由的成员访问、下标、可选链、方法提取和解构，
HTTP 后备服务器的导入与调用、常见响应 Mock 库、全局网络接口替换和 mock.method/stub/spyOn。
这些网络入口保留给 Python 代理，不能通过给界面层增加 TS 响应实现来绕过。
这是保守的语法规则：同名方法也需审查；任意动态计算、反射和字符串执行不保证可静态分析。

现有代理源发现、请求错误和清理适配器单测按位置记录为 `adapter-unit`，每条都有本机单测理由。
其他既有离线浏览器工具测试和登录注册阻断记录为 `migration`，保留原测试，后续逐位置迁移。
新增单测也不会自动获得旧例外，新增普通集成/视觉 Mock 必须失败。
Node mock 的恢复赋值也会被保守识别，清单明确登记相关位置。

依赖图禁止界面操作和辅助层到 `e2e/mitmproxy/`、各视觉套件 `mitmproxy/`、
`network-responses/` 或账号网络伪造脚本的直接或间接依赖。
新增响应实现应归入这些约定层。界面仍可调用代理客户端传递逻辑场景。
唯一的数据例外是共用脱敏标识表 `e2e/mitmproxy/data/diagnostic-paths.json`；
`visual/fixtures/*.json` 是展示属性数据，不是响应实现。Python 导入和任意动态导入不在该 JS/TS 静态图的覆盖承诺内。

## 清单只能缩减

匹配使用文件、规则、诊断文本、源码行指纹和出现次数；行号用于审阅，插入空行不会消耗新名额。
诊断包含实测复杂度/深度，提高数值、增加相同位置次数、移动到另一文件或改变锚点都会失败。
未修复完的函数也不能扩张旧违规。修复至阈值内后，检查会要求删除失效的历史条目，避免旧名额再次使用。

本机默认与 Git `HEAD` 比较；CI 通过 `QUALITY_BASE_REF` 使用 PR base 或 push before。
比较基准必须存在，浅克隆或拼错 ref 会失败；仅首次引入基线、旧 revision 确实没有该文件时允许初始化。
后续新增/替换条目和提高 jscpd 指纹次数均失败。第一次引入的清单必须在本 PR 完整审查。
需要清理重复基线时，可把当前报告的 `duplication.fingerprints` 写入临时文件，与旧基线逐项比较，
只删除消失指纹或降低次数，不能直接接受新增项。检查期间不会自动修改基线。

行内 `eslint-disable`、规则配置注释不能关闭质量规则，即使整文件禁用也由独立扫描拒绝。
Ruff C901 不能通过 noqa 隐藏。改变阈值、扫描范围、工具配置、网络语法规则或任何例外政策都必须经 PR 审查；
不要通过修改配置并重建历史清单消化新违规。

`node --test scripts/quality.test.mjs` 使用临时负例验证复杂度、嵌套、循环、间接越层、无法解析导入、
多种 Mock 入口、规则禁用、清单扩张、新增重复和历史第三份副本；同时验证合法代理单测和数据/文字不误报。
