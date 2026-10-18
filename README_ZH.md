# dsh-quick-restart

**DeepSeek Harness 一键重启插件（Windows）** · One-click restart plugin for the DeepSeek Harness desktop app.

在侧边栏品牌行（deepseekHARNESS 字标右侧）加一个 ⟳ 按钮：点击 → 确认 → 应用在约 **2 秒内**关闭并自动重新打开。

![icon](icon.svg)

## 功能

- **一键重启**：点击侧边栏字标旁的 ⟳ 图标，弹出自带深浅主题适配的确认对话框，确认后自动完成整个重启流程。
- **快**：实测从确认到窗口重新出现约 2 秒（旧版基于 PowerShell 的方案约 14 秒）。
- **主题自适应**：确认对话框读取应用真实底色，明暗主题下都清晰可读。
- **安全兜底**：品牌字标组件不可用时自动降级为侧边栏底部的图标按钮。

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

## 配置

插件的 cordis config（可选）：

| 键 | 默认 | 说明 |
|---|---|---|
| `gracefulSeconds` | `3` | （保留参数）优雅关闭窗口秒数，1–30 |
| `armDelayMs` | `400` | 确认后给浏览器留的绘制时间，0–10000 |

## 排查

日志（均在 `%TEMP%`）：

- `dsh-quick-restart-spawn.log` — 每次重启请求、launcher 写入与 WMI 启动结果
- `dsh-quick-restart-helper.log` — 重启守护进程的完整流程（杀进程 → 重启 → 验证）
- `dsh-quick-restart-launch.log` — launcher 的 stdout/stderr

HTTP 接口（POST）：

- `/quick-restart/api/restart` — 触发重启（body `{"dryRun":true}` 可演练）
- `/quick-restart/api/status` — 状态（exe 路径、helper 是否存在等）
- `/quick-restart/api/logs` — 上述日志的尾部

## 已知限制

- 仅支持 Windows（强杀/重启逻辑依赖 `taskkill`、WMI 与 Job Object 语义）。
- 若 DSH 未来修改进程模型（Job Object、进程名），需要同步更新 helper。

## License

[MIT](LICENSE)
