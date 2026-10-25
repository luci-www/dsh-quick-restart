# Changelog

All notable changes to `dsh-quick-restart`. Versions before 0.4.4 predate this
file — see the git history. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are plain semver and
there is no `Unreleased` section (work lands on a version bump).

## 0.4.7 — 2026-10-25

### Fixed

- **The plugin card told the truth about timing, or rather it stopped lying.**
  `setBundleEnabled()` answers `application: "applied"` only when the bundle's
  patch layer can be swapped live; most third-party bundles answer
  `"restart-required"`, meaning the manifest (`dsh.profile.bundles`) is already
  clean but the layer is still loaded until the next start. Until now the card
  reported every bundle as 停用/启用 regardless, so a user could reasonably
  believe 21 plugins were gone when 13 of them were still running. The message
  now counts the outcomes and says 「其中 N 个要重启一次才真正卸下」.
  Measured on a real 21-plugin profile: 8 hot, 13 restart-required on the way
  out, 21/21 applied on the way back in.

### Changed

- `CLIENT_VERSION` `12` → `13` (the browser bundle is cached per version string,
  so this is also the visible marker that the new client is loaded — it shows up
  in the host log as `restart requested client=13`).
- README / README_ZH: the plugin-control section claimed "turning a plugin off
  is a hot operation when HMR is available". Replaced with the per-bundle
  reality above (8 / 13 measured), since the old sentence read as a promise.

## 0.4.6 — 2026-10-25

### Changed — plugin control is now bundle-level, not entry-level

0.4.5 shipped the feature against loader entries (`listPlugins()` /
`setPluginEnabled()`). That was the wrong unit: the sidebar's 「插件」 page —
the thing a user compares against — lists **bundles**, i.e. packages recorded in
the profile's `dependencies` and loaded through `dsh.profile.bundles`. A plugin
could appear enabled on that page while the entry-level toggle refused it as
`unaddressable`, and vice versa. 0.4.6 re-implements the feature on the same
unit the official page uses:

- `listBundles()` drives the card, so the rows are exactly the installed
  plugins (name, version, description, enabled, removable).
- `setBundleEnabled(name, enabled)` performs the write. Switching a bundle off
  removes its name from `dsh.profile.bundles`; nothing is uninstalled, and
  restoring it is instant.
- Refusals carry the official reason: `management-required` for the 19
  `protectedModules`, `not-removable` for bundles that are not a standalone
  plugin, `unknown-plugin` for stale rows.

### Added

- `self` flag in the `plugins` response: this plugin excludes itself explicitly.
  The official manager does **not** protect it (`protectsManager()` only guards
  the manager's own bundles), so without this the panel could switch off the
  very panel doing the asking. The host rejects it before any write.

### Fixed

- `set-plugin` / `set-plugins` always answer `200` with
  `{applied, rejected, partial, error}`. The interim `207` envelope was
  unreadable by the client (no `error` field), which surfaced as a bare
  "HTTP 207" in the dialog.
- A single toggle through `set-plugin` no longer 400s: the body may be
  `{name, enabled}` or `{names: [...]}`.
- Re-selecting a bundle appends it to the end of `dsh.profile.bundles`, so its
  patch layer gains the highest precedence. Documented rather than worked
  around — the append is official `selectBundle()` behaviour.

## 0.4.5 — 2026-10-25

### Added

- One-click plugin control, **first attempt, entry-level** (superseded by
  0.4.6): `plugins` / `set-plugin` / `set-plugins` endpoints plus the second
  card in the panel. Built on `pluginManager.listPlugins()` /
  `setPluginEnabled(entryId, enabled)`.
- Batch writes are strictly sequential (`await` one before the next) because
  `hmr.runExclusive()` is `AsyncLocalStorage`-based and rejects nested
  transactions ("HMR transactions cannot be nested").
- Every name is validated against the live list **before** anything is written,
  so a stale row can never half-apply a batch.

### Fixed

- `Set-Content -Encoding utf8` (PowerShell 5.1) had rewritten the profile
  `package.json` with a UTF-8 BOM in an earlier debugging session; a BOM makes
  the manifest unparseable and the plugin silently disappears from the sidebar.
  All profile writes now go through `writeFileSync` / atomic writes, and the BOM
  was removed.

## 0.4.4 — 2026-10-25

### Fixed

- **Mojibake in the helper log.** `taskkill` output was read with
  `fs.readFileSync(capture, "utf8")`. Under the WMI launch context (console code
  page 936) `taskkill` writes GBK bytes, so the log showed
  `锟斤拷锟斤拷止 PID 2244` instead of proper text, and failure diagnostics were
  worthless. `decodeConsoleOutput()` now tries strict UTF-8 first, then GBK, then
  latin1. Worth noting for anyone debugging this later: the same command prints
  **English** in an interactive PowerShell and **Chinese** only when launched
  without a console through WMI — which is exactly why the bug survived so long.

## 0.4.3 and earlier

- Restarting happens outside the desktop app's Windows **job object**: a child
  process spawned normally is killed together with the app, so the helper writes
  a `.cmd` launcher and asks `Win32_Process.Create` through WMI to start it. The
  helper runs with no console and `ELECTRON_RUN_AS_NODE=1`, kills every image of
  the app in a single `taskkill /PID … /F /T`, then relaunches the exe with
  `ELECTRON_RUN_AS_NODE` deleted from the environment.
- Restart latency driven down to ~2 s: arm delay 1500 → 400 ms, graceful wait
  8 s → 3 s (a graceful `WM_CLOSE` never worked for Electron child processes —
  it was a guaranteed full 8 s of dead time), and the fixed 1 s post-kill sleep
  replaced by a bounded confirmation poll.
- `readAppVersion()` reads `app.asar`'s header directly to compare versions;
  a `pending/update-info.json` marker newer than the installed build blocks a
  force restart with `409 update-pending` instead of stranding the update.
- Installed as a profile `link:` dependency (like `dsh-startup-screen`), so the
  profile's `bundles` list and `dependencies` stay consistent and a restart
  always loads the working tree.
