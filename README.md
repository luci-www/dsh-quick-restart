# dsh-quick-restart

**One-click restart plugin for the DeepSeek Harness desktop app (Windows).**

Adds a ⟳ button next to the sidebar wordmark: click → confirm → the app closes and relaunches in about **2 seconds**.

See the [Chinese README](README_ZH.md) for the full document (installation, architecture, troubleshooting).

![Confirmation dialog](docs/effect-dialog.png)

## Features

- One-click restart with a theme-aware confirmation dialog (dark/light auto-detected).
- Full restart in ~2 s (an earlier PowerShell-based design took ~14 s).
- Graceful fallback to a sidebar-foot icon button when the brand component is unavailable.

## Install (Windows only)

```powershell
dsh plugin --profile desktop add dsh-quick-restart
```

## How it works

The web client posts to `/quick-restart/api/restart`. The Node half (a cordis plugin running in the DSH Host child process) writes a launcher script and asks WMI `Win32_Process.Create` to start a detached restart helper **outside the app's Job Object** (every DSH process sits in one, so a plainly spawned helper would die with the app). The helper — the Electron binary running in Node mode via `ELECTRON_RUN_AS_NODE=1` — force-kills every app process and relaunches the exe without that variable.

Key measured facts behind the design (details in source comments):

- Detached Windows PowerShell 5.1 exits silently without a console — it cannot be the restart vehicle.
- `taskkill`'s WM_CLOSE never terminates Electron children; a single `taskkill /F /T` over all PIDs is both correct and fastest.
- `ELECTRON_RUN_AS_NODE` must be stripped from the relaunch environment or the app boots as a headless Node process.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/quick-restart/api/restart` | Trigger the restart (body `{ "dryRun": true }` rehearses without killing anything) |
| GET | `/quick-restart/api/status` | Status: exe path, helper presence, etc. |

## Troubleshooting

| Message | Cause | Fix |
| --- | --- | --- |
| `HTTP 405` | The Node half's route is not mounted (plugin not loaded, or a callback-style `ctx.inject` was used), so the POST fell through to the SPA fallback | Make sure `dsh-quick-restart` is in both `dsh.profile.bundles` and `dependencies`, and that `node_modules/dsh-quick-restart` resolves; register with a module-level `inject` plus `ctx.effect` |
| `HTTP 503` | **Not the plugin**: the desktop shell is downloading or installing an update, and `dsh-desktop-host`'s update admission lock answers every request with a bare 503 before routing | Wait for the update to finish. Since v0.3.1 the client backs off and retries (up to 6 attempts) and says so in the dialog |

## Interactive diagram

[docs/dsh-quick-restart-architecture.html](docs/dsh-quick-restart-architecture.html) is a standalone swimlane walk-through of the whole restart path (no network needed).

## License

[MIT](LICENSE)
