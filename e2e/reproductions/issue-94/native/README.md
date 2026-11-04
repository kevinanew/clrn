# 本机原生金币服务链

这是 #94 的补充入口，复用同一固定 Release 和两个独占账号。登录、metadata、健康探测及其他业务仍走真实 staging；金币匹配和本轮房间操作交给本机未修改的德州、匹配、房间、带入、RPC 网关服务，以及真实 Redis Cluster、Centrifugo。钱包是独立测试账本，绝不转发共享钱包交易。

当前浏览器入口只支持 `normal` 和 `conflict`。它不能替代 #94 的完整 HTTP、WebSocket、钱包传输故障、真实余额不足及提交后丢回复矩阵，也不能证明共享 staging 的后端部署版本。PR 继续保持草稿。

## 前置条件

- 沿用主复现入口的 Node、Chromium、staging 测试令牌和 GitHub Release 凭据；还需 `uv`、`python3`、`git`、`lsof`。
- 本机端口 8000 空闲。原始延迟任务使用这个地址；入口不会修改任务源码或占用已有服务。
- `ISSUE94_SOURCE_ROOT` 指向已有后端检出目录，默认为 `~/github/kevinanew`。所需提交列在 [runtime.py](runtime.py) 的 `SOURCES`。入口创建独立 detached worktree，执行 `uv sync --frozen --no-install-project`，保留用户原有工作区。
- 同一目录需有 `app_user_flask`。只在内存读取其提交中的 staging 签名配置，校验两个正常登录页面取得的真实 JWT，再配置本机 Centrifugo。没有签名匹配即失败；不生成测试用户的替代凭据。该配置来源不能当作实际 staging 部署版本。
- 提供 Redis Server/CLI **7.2.5** 和 Centrifugo **2.5.1** 二进制。启动器核对版本并记录实际二进制 SHA-256。已实测 macOS arm64 与 Rosetta 下的 Centrifugo Darwin amd64 包；其他平台需提供对应平台的同版本二进制。

Redis 官方源码为 [redis-7.2.5.tar.gz](https://download.redis.io/releases/redis-7.2.5.tar.gz)，SHA-256 为 `5981179706f8391f03be91d951acafaeda91af7fac56beffb2701963103e423d`。校验后可执行 `make -j2 MALLOC=libc BUILD_TLS=no redis-server redis-cli`，无需安装到系统目录。

Centrifugo 官方包为 [v2.5.1 Darwin amd64](https://github.com/centrifugal/centrifugo/releases/download/v2.5.1/centrifugo_2.5.1_darwin_amd64.tar.gz)，SHA-256 为 `0f428f3ecfe2a4a834f026cc4512917403fe0167dc7dea97ebb7d9bb3edc38e3`。这些包的来源及摘要必须核实，不能用不同版本静默替代。

## 执行

```sh
export ISSUE94_SOURCE_ROOT="$HOME/github/kevinanew"
export ISSUE94_REDIS_SERVER="/path/to/redis-7.2.5/src/redis-server"
export ISSUE94_REDIS_CLI="/path/to/redis-7.2.5/src/redis-cli"
export ISSUE94_CENTRIFUGO="/path/to/centrifugo"

ISSUE94_NATIVE_MODE=normal node e2e/reproductions/issue-94/run.mjs --coin-native
ISSUE94_NATIVE_MODE=conflict node e2e/reproductions/issue-94/run.mjs --coin-native
```

每次只运行一个案例。两个账号锁在整个服务、网页和清理周期内持有；不会申请 CI 专用账号。固定 Release 下载与摘要校验沿用 [主入口](../run.mjs)。每轮产物写入 `e2e/test-results/issue-94/<run-id>/native/`，包括版本和文件指纹、登录后录像、稳定截图、真实消息负载及摘要、账本、耗时、内存和清理结果。认证状态只保存在内存，原始服务日志和签名配置在私有临时目录中，结束后删除。

端口探测采用服务实际使用的地址复用规则，允许上一轮连接的 `TIME_WAIT`，仍拒绝其他活跃监听器；真实 TCP 自测可执行 `python3 -m unittest discover -s e2e/reproductions/issue-94/native -p test_ports.py -v`。基础设施启动失败另写 `native-startup-failure.json`，不会把启动失败当成钱包故障复现。

正常轮通过真实菜单开启自动补码、手动带入，再使用真实 all-in 控件。故障轮在同一正常链路之后注入交易冲突，记录网页提示、再次入座及解除故障后的唯一恢复扣款。正确行为断言失败时退出非零，没有 skip、xfail 或自动重试。

## 隔离与证据边界

- 不改变共享大厅的 IP 规则。本机独立大厅明确设置 `check_ip_address=false`，并将玩家操作时限设为 60 秒，为完整动画取证和两个真实带入操作留出时间；其余房间规则及实际创建响应保留来源记录。钱包 SDK 超时、重试和游戏结算实现均保持原样。
- 自动补码的钱包请求 memo **不含房间 UUID**。故障控制先核实专用 Redis 中只有这一张房间、玩家恰好为两个独占账号，再按玩家、自动补码 memo 和真实交易编号记录命中。证据中的 `roomScope` 是已核实的实例范围，不是假称从钱包请求中解析出的房间号。
- 网页仍建立原有 staging WebSocket；额外连接以正常登录取得的原始 JWT 鉴权，只有本轮金币命令送往真实本机网关。本机实际下发的回复和发布消息才会转给网页，并记录原始负载 SHA-256；不构造游戏推送。
- 截图先等待服务消息中的延迟序列走完，再核对实际弹窗或筹码状态，最后使用统一的动画、透明度及布局稳定检查。不会暂停应用时钟或移除动画。
- 正常对照核对手动带入和自动补码账本。清理通过实际退出和关房接口执行，再检查两个初始钱包余额的总额。只操作本轮房间和本机进程；退出码同时反映资金及资源清理失败。
- 在原型实验中，交易冲突确实被吞掉，网页只显示带入弹窗。再次入座仍为带入弹窗，**没有复现原反馈的 `player_not_enough_stack`**。该差异必须保留，不能把吞错路径直接宣布为原事件完整根因。
