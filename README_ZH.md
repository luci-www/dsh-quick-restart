# dsh-quick-restart

**DeepSeek Harness 一键重启插件（Windows）** · One-click restart plugin for the DeepSeek Harness desktop app.

在侧边栏品牌行（deepseekHARNESS 字标右侧）加一个 ⟳ 按钮：点击 → 确认 → 应用在约 **2 秒内**关闭并自动重新打开。

![对话框效果](docs/effect-dialog.png)

## 功能

- **入口在侧边栏「插件」正下方**：`sidebar.panellist` 里 order 1，点开是一个面板，里面有状态、重启按钮和最近的 helper 日志。
- **快**：实测从确认到窗口重新出现约 2 秒（旧版基于 PowerShell 的方案约 14 秒）。
- **一键管理插件**：面板第二张卡片给出和左侧栏「插件」页同一份**已安装插件**清单，显示运行状态、逐行开关，并带「一键关闭其他插件（N）」和「全部恢复（N）」两个批量动作——全程走官方 `pluginManager`，只卸载 bundle 层（不动依赖、不是卸载包），核心模块永远受保护。
- **保护官方升级**：检测到待安装的更新时会拒绝强制重启，并提示改用官方「立即安装并重启」（原因见下）。

### 为什么入口不再放品牌字标旁边（v0.4 变更）

v0.3 把按钮注册进 `sidebar.brand.name` 并给了 `priority: -1`。那个槽位是 `kind: "single"`，同一时刻只有一个注册生效——`-1` **会盖掉官方的品牌单元**（`@deepseek-ai/dsh-client-ui-brand-official` 在 0 位）。为了一个按钮去遮蔽官方 UI 是不必要的风险，而且 `sidebar.panellist` 本来就是壳体文档里「面板选择行」的正式座位：宿主自己画按钮，点击后 `selectPanel(id)` 打开 `key` 相同的 `main` 面板。所以 v0.4 改用 `main` + `sidebar.panellist`（order 1，紧挨「插件」），完全不动品牌行。

### 为什么强制重启会破坏官方升级（已修复）

DSH 的更新协调器（`DesktopUpdateCoordinator`）在构造时设了：

```js
this.updater.autoDownload = false;
this.updater.autoInstallOnAppQuit = false;   // ← 关键
```

也就是说**下载完的更新不会在退出时自动安装**，安装只有一条路：应用内「立即安装并重启」→ `beforeRestart()` → `host.updateTasks("lock")`（这一刻起所有 HTTP 请求都会被回 **503**）→ 关窗 → `host.stop(true)` **要求干净退出** → `updater.quitAndInstall(true, true)`。

而本插件的重启是 `taskkill /F /T` 强杀：它绕过了整条官方流程，所以

- 待安装的更新会一直躺在 `…\@deepseek-aidsh-desktop-updater\pending\` 里装不上；
- 如果强杀恰好落在官方安装窗口内，`host.stop(true)` 的干净退出契约被破坏，官方升级直接失败（`stop-failed`），并且鉴权锁会让之后一段时间所有请求都是 503。

v0.4 在三层都加了保护，插件不会再 sabotage 升级：

| 层 | 行为 |
|---|---|
| Node 半进程 | 启动 helper 前读 `pending/update-info.json`，并把里面的版本号和**当前安装版本**（直接读 `<app>\resources\app.asar`）比较：只有 pending **严格更新**时才返回 **409 `update-pending`** |
| helper | 临杀前再检查一次该标记（防止「点了已确认 → 下载刚好完成」的竞态），命中就直接中止、不杀 |
| 面板 | 顶部显示黄色警告条 + 禁用按钮，明确告诉你用官方升级 |

> **v0.4.2 修正**：`electron-updater` 在安装成功后**不会**删除 `pending\update-info.json`，所以「有标记」不等于「有更新待安装」。早期版本只看到文件就 409，会导致升级明明已经完成、按钮却永久变灰。现在按版本号判断：`pending ≤ 已安装` 视为残留标记，自动放行（`status.pendingUpdate.stale === true`）。

> **v0.4.3 修正**：读 `app.asar` 时 Host 运行在 `ELECTRON_RUN_AS_NODE=1` 下，Electron 的 fs 补丁会把任何 `*.asar` 当成「压缩包里的目录」，`openSync(app.asar, "r")` 直接抛 `ENOENT, not found in …app.asar` —— 于是版本号读成 `null`，守卫又变得保守（继续 409）。现在读取期间临时设 `process.noAsar = true` 绕过该补丁，并在真实 Host 运行时下验证：`currentVersion = 0.2.1-rc.3`、`stale = true`、重启返回 200。

需要强制绕过时（不推荐）：`POST /quick-restart/api/restart`，body 传 `{"force":true}`。

## 安装

要求：Windows、DeepSeek Harness 桌面版。

```powershell
dsh plugin --profile desktop add dsh-quick-restart
```

或手动安装：克隆本仓库到任意目录，然后把它复制（或 `npm link`）到 profile 的 `node_modules` 并加入 `dsh.profile.bundles`：

```
# 1. 复制到插件目录
Copy-Item -Recurse dsh-quick-restart "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\"
# 2. 在 C:\Users\<你>\.dsh\profiles\desktop\package.json 的 dsh.profile.bundles 数组末尾加一行
#    "dsh-quick-restart"
# 3. 重启 DeepSeek Harness
```

## 使用

1. 点击侧边栏 deepseekHARNESS 字标右侧的 ⟳ 图标（若品牌组件不可用，则在侧边栏底部）。
2. 确认对话框中点「立即重启」。
3. 约 2 秒后应用关闭并自动重新打开，登录态与已保存会话保留。

> 注意：重启会中断正在进行中的回答（与会话日志持久化一致），效果等同于手动重启应用。

## 工作原理（为什么会有一个"重启守护进程"）

重启按钮的完整链路：

```
Client (web)  ──POST /quick-restart/api/restart──▶  Node 半进程 (cordis 插件, Host 子进程)
                                                        │ 写 launcher.cmd + spawn PowerShell
                                                        ▼
                                              WMI Win32_Process.Create
                                                        │ 父进程改为 WmiPrvSE.exe
                                                        ▼
                                              restart-helper.cjs（Electron exe 以 Node 模式运行）
                                              强杀全部应用进程 → spawn(detached) 重启 exe
```

几个实测得出的关键设计（详细原因见源码注释）：

1. **不能用分离式 PowerShell**：Windows PowerShell 5.1 在无控制台的 detached 模式下启动即静默退出（~70ms，什么都不做）。
2. **必须逃出 Job Object**：DSH 全部进程（main/GPU/renderer/Host）都在 Job Object 里，普通子进程会随应用被杀。WMI `Win32_Process.Create` 把新进程挂到 `WmiPrvSE.exe` 下，正好在 Job 外。
3. **用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1`** 跑 helper（这正是 DSH 启动自己 Host 子进程的方式），重启时再删掉该变量拉起真正的 GUI。
4. **强杀优于优雅关闭**：taskkill 的 WM_CLOSE 对 Electron 子进程一律无效（"只能强制终止"），所以直接 `taskkill /F /T` 全部 PID 一次搞定。
5. **重启时必须删除 `ELECTRON_RUN_AS_NODE`**，否则应用会以纯 Node 模式启动、无窗口。
6. **webServer 必须模块级注册**：用 `ctx.inject(["webServer"], cb)` 这种回调式注入时，cb 收到的是子 ctx 而非 service，路由根本挂不上，POST 会落到 SPA fallback 返回 **405**。正确写法是模块级 `const inject = ["webServer"]` + `ctx.effect(() => ctx.webServer.register(...))`。

### 让 Host 真的能退出（v0.4.1）

官方升级最后的失败信息是：

```
Desktop update: Host did not complete graceful task teardown
(exit null, signal SIGTERM, shutdown acknowledged true, graceful deadline exceeded true)
```

读 `_electron_main.js` 的 `stop(requireGraceful)` 可以还原它的判定：

```js
child.send({ type: "shutdown" });
const graceful = await exitsWithin(exited, 1e4);   // ← 10 秒等它自己退
if (!graceful) child.kill("SIGTERM");
...
if (requireGraceful && (!graceful || child.exitCode !== 0 || !this.shutdownCompleted)) throw new DesktopHostUncleanExitError(...)
```

Host 侧（`_host_index.js`）确实照做了：`shutdown.shutdown(0)` → 发 `shutdown-complete` → `process.disconnect()`。但 Node 只有在**事件循环排空后**才会退出；只要某个插件留着 ref 定时器或子进程管道，进程就永远不退 → 10 秒后 SIGTERM → `exit null` → 拒绝安装。

**实测归因**（逐个加载 profile 里 16 个带 `dsh` 清单的插件，dispose 后统计残留句柄与定时器创建栈）：

| 插件 | dispose 后残留 |
|---|---|
| `billion-context` | **5 个定时器**，含 `setInterval(10000) armRecoveryTimer`、`setTimeout(499) refreshTimeout`、`setTimeout(5000)` |
| `dsh-plugin-wallpaper-engine` | 2 个定时器（3000 / `scheduleAdapterRestart` 30000） |
| `@liustack/modlens` | 1 个定时器（`scheduleRetry` 5000） |
| `@xmanrui/dsh-im` | 0 个定时器，2 个 PipeWrap（通道连接） |
| **`dsh-quick-restart`** | **0** |

所以本插件不是把 Host 拖住的那个。但升级失败的直接原因是这个泄露，而本插件跑在同一个 Host 里、又有能力兜底，于是 v0.4.1 加了一段收尾逻辑，**不改任何第三方插件**：

```
收到 process 'disconnect'（Host 已确认 shutdown 并断开 IPC）
  └─ 记一条日志：当时还活着的资源统计
  └─ 挂一个 unref 定时器（默认 2s）
       ├─ 循环能排空 → 进程早就自然退出，定时器根本不会触发
       └─ 循环被泄漏句柄拖住 → 2s 后 process.exit(0)
```

`exit 0` + 在 10 秒内 = 满足 `requireGraceful`，安装器得以继续。端到端验证：模拟一个 10 秒 interval 泄漏，Host 路径下 **2045 ms 退出，code 0**；无泄漏时 **36 ms** 自然退出。

交互式泳道讲解图：[docs/dsh-quick-restart-architecture.html](docs/dsh-quick-restart-architecture.html)

## 配置

插件的 cordis config（可选）：

| 键 | 默认 | 说明 |
|---|---|---|
| `armDelayMs` | `400` | 确认后给浏览器留的绘制时间，0–10000 |
| `shutdownExitMs` | `2000` | Host 确认 shutdown 并断开 IPC 后，多久强制 `exit(0)`；0–9000，直接影响官方升级的成功率 |

## 排查

日志（均在 `%TEMP%`）：

- `dsh-quick-restart-spawn.log` — 每次重启请求、launcher 写入与 WMI 启动结果
- `dsh-quick-restart-helper.log` — 重启守护进程的完整流程（杀进程 → 重启 → 验证）
- `dsh-quick-restart-launch.log` — launcher 的 stdout/stderr

HTTP 接口（POST）：

- `/quick-restart/api/restart` — 触发重启（body `{"dryRun":true}` 可演练；`{"force":true}` 可绕过待更新保护）
- `/quick-restart/api/status` — 状态（exe 路径、helper 是否存在、`pendingUpdate` 等）
- `/quick-restart/api/logs` — 上述日志的尾部
- `/quick-restart/api/plugins` — 已安装插件清单：每个 bundle 的 `name` / `enabled` / `removable` / `readOnlyReason` / `error` / `self`，以及 `counts`
- `/quick-restart/api/set-plugin` — 切换单个插件：`{"name":"dsh-better-sidebar","enabled":false}`
- `/quick-restart/api/set-plugins` — 批量切换：`{"names":["…"],"enabled":false}`（单次最多 200 个，严格逐个串行执行）

所有 `set-plugin*` 请求一律返回 `200`，逐条结果在 `value.applied` / `value.rejected`（原因：`unknown-plugin` / `management-required` / `not-removable` 或 `ManagementFailure` 的 code），部分成功时 `value.partial === true`。**先校验、后写入**：任何一条不合法都会在动盘前被拦进 `rejected`，不会出现半应用。字段以 `names` 为准；`name`、`entryId`、`entryIds` 仍被接受，好让浏览器里缓存的旧版前端继续可用。

## 一键管理插件（v0.4.6）

面板第二张卡片列出 profile 里**已安装的插件**——和左侧栏「插件」页完全同一份清单，提供逐行开关和两个批量按钮：「一键关闭其他插件（N）」「全部恢复（N）」。

这些是 *bundle*：登记在 profile `dependencies` 里的包。关闭只是把它从 `dsh.profile.bundles` 里摘掉，于是它不再被加载——**不是卸载**，依赖全部保留，随时可以一键装回。有一点沿袭自官方管理器的行为需要注意：重新启用会把包名**追加到 `dsh.profile.bundles` 末尾**，于是它的 patch 图层变成最高优先级。

三条设计原则保证它安全：

1. **不自己写任何 profile 文件**。它调的是官方 `pluginManager.listBundles()` / `setBundleEnabled()`——和内置插件管理器界面走同一条路，于是 `withFileLock`、`writeFileAtomic`、清单读写这些脏活全是官方实现。
2. **只碰官方清单标为 `removable` 的 bundle**。贡献 19 个 `protectedModules` 之一的包（plugin manager、cordis loader、webserver、HMR……）会被官方标成 `readOnlyReason: "management-required"`，请求在写盘前就被拒——核心永远活着。
3. **本插件被显式排除**。它只是个普通包，官方页面允许把它关掉，但那样会 dispose 掉正在提问的这张面板，所以 Host 侧在写盘前直接拒成 `management-required`。

是不是立刻生效？看具体是哪个 bundle，不能一概而论。`setBundleEnabled` → `change()` → `configure()` → `hmr.runExclusive()` → `reconcileProfile()` 有能力把 bundle 的 layer 热替换掉（`application: "applied"`），但大多数第三方 bundle 会回 `application: "restart-required"`：清单（`dsh.profile.bundles`）已经干净了，可 layer 还在内存里跑，要等下次启动才真正卸下。在一个真实的 21 插件 profile 上实测：关闭时 8 个热生效、13 个需要重启。所以卡片会照实说「其中 N 个要重启一次才真正卸下」，而不是假装插件已经消失——而重启按钮就在它上面。由于 `runExclusive` 基于 `AsyncLocalStorage` 且拒绝嵌套事务（"HMR transactions cannot be nested"），这些调用是严格串行 `await` 的，绝不并发。

### 报错对照

| 提示 | 原因 | 处理 |
|---|---|---|
| `HTTP 405` | Node 半进程的路由没挂上（插件未被加载，或用了回调式 `ctx.inject` 写法），请求落到 SPA fallback | 确认 `dsh.profile.bundles` 与 `dependencies` 里都有 `dsh-quick-restart`，且 `node_modules/dsh-quick-restart` 可解析；改为模块级 `inject` + `ctx.effect` 注册 |
| `HTTP 503` | **不是插件的问题**：桌面端正在下载/安装更新，`dsh-desktop-host` 的更新准入锁会给所有请求回裸 503，插件的路由根本没收到请求 | 等更新完成再点；v0.3.1 起客户端会自动退避重试（最多 6 次），并在对话框里显示「应用正在准备更新」 |
| `update-pending`（409） | 有**下载好但确实还没装上**的更新（插件比较 pending 版本与已安装版本，只有更新时才拦）。强制重启走不到官方安装流程，会把升级卡住 | 用 DSH 官方「立即安装并重启」；装完后即使 `pending\update-info.json` 还在，插件也会按版本号识别为残留并自动放行 |

## 已知限制

- 仅支持 Windows（强杀/重启逻辑依赖 `taskkill`、WMI 与 Job Object 语义）。
- 插件管理只覆盖官方清单标为 `removable` 的 bundle；贡献受保护核心模块的包与本插件自身不可关闭（官方设计，见上）。
- 若 DSH 未来修改进程模型（Job Object、进程名）或更新流程，需要同步更新 helper 与待更新检测。
- 本插件无法执行官方升级：`autoInstallOnAppQuit = false` 时安装只能由 Electron 主进程的 `quitAndInstall` 完成。

## License

[MIT](LICENSE)
