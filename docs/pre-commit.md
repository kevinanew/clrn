# 提交前检查

本地与 `.github/workflows/account-tools.yml` 复用根目录 `.pre-commit-config.yaml`，
Python 依赖版本统一记录在 `requirements-dev.txt`。pre-commit 只调度现有 npm 命令，
具体规则仍由 ESLint、Ruff、ShellCheck、actionlint、文件行数检查和 TypeScript 配置维护。

## 首次克隆

验证环境为 Node.js 24.14.0、npm 11.9.0、Python 3.12.12、uv 0.11.32、pre-commit 4.6.0。
Node.js 24.14.0 自带所需 npm；先安装 Node.js 和
[uv 0.11.32](https://docs.astral.sh/uv/getting-started/installation/)，再执行：

```sh
node --version
npm --version
uv --version
npm ci
uv venv --python 3.12.12 .venv
uv pip install --python .venv/bin/python -r requirements-dev.txt
.venv/bin/python --version
.venv/bin/pre-commit --version
.venv/bin/pre-commit install
.venv/bin/pre-commit run --all-files
```

uv 会在需要时下载指定 Python；首次安装及 lint 工具缓存未命中时需要网络。
`.venv/` 已忽略，不依赖全局 Python 包，也不需要激活虚拟环境。
Git hook 使用安装时的虚拟环境路径，普通 `git commit` 仍要求 Node、npm、uv 在 PATH 中。
移动克隆目录或重建环境后重新执行 `.venv/bin/pre-commit install`。
Git 不会复制本地 hook，每个新克隆都要安装；CI 无论本地是否安装或跳过 hook 都独立检查。

## 触发范围与执行方式

| Hook | 命令 | 触发路径 | 文件名参数 | 执行方式 |
| --- | --- | --- | --- | --- |
| `lint` | `npm run lint` | 全部路径，含文档、配置、删除文件和空提交 | 不传入 | 系统环境，全仓一次，串行 |
| `typecheck` | `npm run typecheck` | 全部路径，含文档、配置、删除文件和空提交 | 不传入 | 系统环境，全仓一次，串行 |

`files: ^` 匹配全部路径，`always_run: true` 确保没有匹配文件时也执行。
`pass_filenames: false` 与 `require_serial: true` 避免按文件批量重复调用全仓检查。
两个 hook 仅在 `pre-commit` 阶段运行；只检查，不带 `--fix` 或自动格式化参数。
lint 包含 JavaScript/TypeScript、Python、Shell、工作流和文件长度；typecheck 同时检查根目录与 `visual/`。
Python 文件强制不超过 500 物理行（含空行、注释和 docstring），已跟踪及未忽略的新文件均检查。
可用 `npm run lint:python:lines` 独立执行；扫描范围和失败条件见 [质量门禁](../quality/README.md#python-文件长度111)。

手动检查当前工作区全部文件：

```sh
.venv/bin/pre-commit run --all-files
# 查看各检查的完整输出
.venv/bin/pre-commit run --all-files --verbose
# 运行现有完整本机门禁，包括单元测试
npm run check
```

CI 在 push、PR 和手动触发时执行同一份配置，随后验证真实 Git 提交行为并运行 `npm test`。
浏览器截图、Staging 连接、账号分配、Android 和 iOS 测试继续使用各自工作流，不进入提交 hook。

## 失败与部分暂存

静态错误会原样输出检查器诊断，hook 和 `git commit` 均非零退出，提交不会生成。
先修复错误，再用 `git add` 或 `git add -p` 暂存要提交的修改，重试提交。
可单独运行 `npm run lint`、`npm run typecheck` 定位错误；只需修改对应源码或配置。
如需自动修复，请明确手动执行 `npx eslint <文件> --fix` 或
`uvx --from ruff==0.15.12 ruff check <文件> --fix`，审查差异后重新暂存。
Shell、工作流、类型和行数问题按诊断手动修复。

提交时 pre-commit 临时保存未暂存修改，只检查暂存版本，结束后恢复未暂存内容；
`--all-files` 则检查当前工作区。不要在检查期间并发修改文件。
检查成功或失败后，都可用 `git status`、`git diff`、`git diff --cached` 核对工作区与索引。
若进程中断或恢复失败，保留终端给出的补丁路径，先备份当前修改，再按提示恢复补丁；不要直接丢弃修改。

若报找不到命令，按首次克隆步骤补齐依赖，并确认 Node、npm、uv 在 PATH 中。
网络或工具安装失败同样阻止提交；解决安装问题后重跑，不吞掉退出码。

## 升级与卸载

升级 pre-commit 时修改 `requirements-dev.txt` 的精确版本，并同步配置中的最低版本及文档：

```sh
uv pip install --python .venv/bin/python -r requirements-dev.txt
.venv/bin/pre-commit install
.venv/bin/pre-commit run --all-files
.venv/bin/python scripts/verify-pre-commit.py
```

本配置仅使用本地 hook，`pre-commit autoupdate` 不会升级 npm、Python 工具或框架本身。
更新 Node、Python 或 uv 时，同时修改 CI 和本地安装说明；ESLint/TypeScript 等依赖通过
`package.json` 和锁文件更新，Ruff/ShellCheck/actionlint 版本仍在现有 npm 入口固定。

卸载前先运行：

```sh
.venv/bin/pre-commit uninstall
```

之后可按需删除 `.venv/`。卸载只影响该克隆的 Git hook，CI 仍执行检查。
再次启用时按首次克隆步骤重装。

## 可重复验收

```sh
.venv/bin/python scripts/verify-pre-commit.py
```

此脚本对当前已提交的 HEAD 建立临时克隆，重新安装依赖和 Git hook，执行实际提交，
验证全量检查、不同语言的静态错误、部分暂存的失败与成功、文档及删除文件触发，
以及工作区、索引和未暂存内容的保留。成功与失败场景都由 PR 的仓库检查运行；
预期的失败必须确实阻止提交，才能使验收通过。脚本不接触账号、设备或远端测试环境。

行为参考：[pre-commit 官方文档](https://pre-commit.com/)。
