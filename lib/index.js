/**
 * dsh-quick-restart — Node half (cordis plugin on the Host).
 *
 * The UI lives in the Client half (client/index.js), delivered through the
 * standard client-plugin channel: package.json declares `exports["./client"]`
 * plus `dsh.client = { inject: ["@deepseek-ai/dsh-client-ui-slots"], platform: "web" }`,
 * and that file is a `window.__ModuleLoader__.load({ id, factory })` bundle —
 * the same shape dsh-mcp-connector and dsh-better-sidebar ship.
 *
 * Host wiring mirrors dsh-better-sidebar/lib/index.js:6871-7790: `webServer` is
 * declared as a MODULE-LEVEL `inject` entry, so apply() runs only once the
 * service exists, and the route is mounted with
 * `ctx.effect(() => ctx.webServer.register({ kind: "prefix", path, handler }), label)`.
 * (An older revision used a callback-style `ctx.inject(["webServer"], cb)` and
 * read `cb.register` — that argument is a child ctx, not the service, so nothing
 * was mounted and every request fell through to the SPA fallback: POST → 405.)
 *
 * RESTART MECHANISM (all of it measured on the real host — see
 * lib/restart-helper.cjs for the experiments):
 *
 *   1. A detached PowerShell script CANNOT do this job. On Windows
 *      `detached: true` = DETACHED_PROCESS (no console) and Windows PowerShell
 *      5.1 exits silently at startup without a console: exit code 0 after ~70 ms
 *      with zero effects, in every invocation shape.
 *   2. The Electron binary in Node mode does work while detached
 *      (`ELECTRON_RUN_AS_NODE=1`, exactly how DSH starts its own Host child), so
 *      the restart itself is performed by lib/restart-helper.cjs.
 *   3. That helper must OUTLIVE the app it kills. Every DSH process (main, GPU,
 *      renderer, Host child — verified with IsProcessInJob) sits in a Job Object,
 *      and a child inherits its parent's job, so a plainly spawned helper would
 *      die at the moment the app's last job handle closes — i.e. exactly when the
 *      app is being killed.
 *   4. Escape hatch: `Win32_Process.Create` parents the new process to
 *      WmiPrvSE.exe, which is outside the job (measured: caller inJob=True, the
 *      WMI child inJob=False), and such a child still gets the *user's*
 *      environment (TEMP/USERPROFILE/USERNAME verified). So this half writes a
 *      tiny launcher .cmd and asks PowerShell (spawned normally, with pipes, which
 *      runs fine) to WMI-create it. If WMI is unavailable the code falls back to a
 *      direct detached spawn, which still works whenever the job is not
 *      kill-on-close.
 *
 * Endpoints (all POST, envelope {ok:true,value} / {ok:false,error}):
 *   /quick-restart/api/restart  start the restart helper (body {dryRun:true} to rehearse)
 *   /quick-restart/api/status   {armed, exe, helper, helperExists, image, armDelayMs}
 *   /quick-restart/api/logs     tails of the spawn log, the helper log and the launcher log
 */
import { spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));

/** Restart helper that owns the whole restart (Electron binary in Node mode). */
const HELPER = join(PLUGIN_DIR, "restart-helper.cjs");
/** Written by this half: every launch attempt and its outcome. */
const SPAWN_LOG = join(tmpdir(), "dsh-quick-restart-spawn.log");
/** Written by lib/restart-helper.cjs: every step of the restart. */
const HELPER_LOG = join(tmpdir(), "dsh-quick-restart-helper.log");
/** Written by the legacy scripts/restart.ps1 (no longer invoked). */
const SCRIPT_LOG = join(tmpdir(), "dsh-quick-restart.log");
/** Launcher handed to WMI: sets ELECTRON_RUN_AS_NODE and starts the helper. */
const LAUNCH_CMD = join(tmpdir(), "dsh-quick-restart-launch.cmd");
/** stdout/stderr of the WMI-launched launcher (the helper logs by itself). */
const LAUNCH_LOG = join(tmpdir(), "dsh-quick-restart-launch.log");
/** Windows PowerShell (5.1) — the only way to reach Win32_Process.Create. */
const POWERSHELL = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
/** Give the browser time to paint "restarting" before the app disappears. */
const DEFAULT_ARM_DELAY_MS = 400;

/**
 * electron-updater's pending-download marker (updaterCacheDirName comes from the
 * app's own `app-update.yml`). DSH sets `autoInstallOnAppQuit = false`, so a
 * downloaded update is installed ONLY by the in-app `quitAndInstall` flow, which
 * first needs a CLEAN Host stop. A force-kill restart (this plugin) bypasses that
 * flow, so the update would never install — and a kill landing inside the
 * official install window breaks it outright. While a *real* pending update
 * exists the restart endpoint therefore refuses with 409 rather than sabotaging
 * the upgrade.
 *
 * IMPORTANT: electron-updater never deletes this marker after a successful
 * install — `pending\update-info.json` survives forever, describing the build
 * that is ALREADY installed (measured: file says 0.2.1-rc.3, the running
 * `resources/app.asar` says 0.2.1-rc.3 too). Treating a bare marker as "update
 * pending" permanently disables the button, so the marker's version is compared
 * against the running build and only a strictly newer one blocks a restart.
 */
const PENDING_UPDATE = join(
	process.env.LOCALAPPDATA ?? "",
	"@deepseek-aidsh-desktop-updater",
	"pending",
	"update-info.json"
);

/**
 * Running desktop build version, read straight out of `<app>/resources/app.asar`.
 *
 * The Host runs under `ELECTRON_RUN_AS_NODE=1`, where Electron installs an fs
 * shim that treats every `*.asar` path as a DIRECTORY inside an archive, so a
 * plain `openSync(app.asar, "r")` throws `ENOENT, not found in …app.asar`
 * (measured). `process.noAsar = true` is the documented escape hatch that makes
 * the shim pass the call through to the real filesystem.
 */
function readAppVersion(exePath) {
	if (typeof exePath !== "string" || exePath === "") return null;
	const previousNoAsar = process.noAsar;
	process.noAsar = true;
	let fd = null;
	try {
		fd = openSync(join(dirname(exePath), "resources", "app.asar"), "r");
		const head = Buffer.alloc(16);
		readSync(fd, head, 0, 16, 0);
		const headerSize = head.readUInt32LE(12);
		const headerBuf = Buffer.alloc(headerSize);
		readSync(fd, headerBuf, 0, headerSize, 16);
		const entry = JSON.parse(headerBuf.toString("utf8"))?.files?.["package.json"];
		if (!entry || typeof entry.size !== "number") return null;
		const base = 16 + headerSize + ((8 - (headerSize % 8)) % 8);
		const data = Buffer.alloc(entry.size);
		readSync(fd, data, 0, entry.size, base + Number(entry.offset));
		const version = JSON.parse(data.toString("utf8"))?.version;
		return typeof version === "string" ? version : null;
	} catch {
		return null;
	} finally {
		if (fd !== null) {
			try {
				closeSync(fd);
			} catch {}
		}
		process.noAsar = previousNoAsar;
	}
}

/** Numeric-ish version compare; handles `1.2.3-rc.4` style prerelease tails. */
function compareVersion(left, right) {
	const a = String(left).split(/[.-]/u);
	const b = String(right).split(/[.-]/u);
	const length = Math.max(a.length, b.length);
	for (let index = 0; index < length; index += 1) {
		const x = a[index];
		const y = b[index];
		if (x === undefined && y === undefined) return 0;
		// A build that ran out of segments is the STABLE one and wins over a
		// prerelease tail ("0.2.1" > "0.2.1-rc.3"), but loses to a numeric
		// continuation ("0.2.1" < "0.2.1.1").
		if (x === undefined) return Number.isNaN(Number(y)) ? 1 : -1;
		if (y === undefined) return Number.isNaN(Number(x)) ? -1 : 1;
		const nx = Number(x);
		const ny = Number(y);
		if (Number.isNaN(nx) || Number.isNaN(ny)) {
			if (x !== y) return x < y ? -1 : 1;
			continue;
		}
		if (nx !== ny) return nx < ny ? -1 : 1;
	}
	return 0;
}

/**
 * Pending update identity, or null when none is waiting to install.
 * `stale: true` means the marker only describes the build that is already
 * running (a leftover), so it must not block a restart.
 */
function pendingUpdate(exePath) {
	try {
		const raw = readFileSync(PENDING_UPDATE, "utf8");
		const parsed = JSON.parse(raw);
		const fileName = typeof parsed?.fileName === "string" ? parsed.fileName : "";
		const version = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/u.exec(fileName)?.[1] ?? null;
		const currentVersion = readAppVersion(exePath);
		const stale =
			version !== null && currentVersion !== null && compareVersion(version, currentVersion) <= 0;
		return { version, fileName, path: PENDING_UPDATE, currentVersion, stale };
	} catch {
		return null;
	}
}

/** Plugin identity for cordis.yml rows. */
const name = "dsh-quick-restart";

/** Services required before mounting: the HTTP carrier service. */
const inject = ["webServer"];

function logSpawn(line) {
	try {
		appendFileSync(SPAWN_LOG, `${new Date().toISOString()} ${line}\n`, "utf8");
	} catch {}
}

function tail(file, lines) {
	try {
		const text = readFileSync(file, "utf8");
		return text.split(/\r?\n/u).filter((line) => line !== "").slice(-lines).join("\n");
	} catch (error) {
		return `<unreadable: ${String(error)}>`;
	}
}

/**
 * Finish the Host's own shutdown when leaked handles would keep it alive.
 *
 * The desktop update flow calls `host.stop(true)`, which sends `{type:"shutdown"}`,
 * waits 10 s for the child to exit, then escalates to SIGTERM. The Host acks the
 * shutdown (`shutdown-complete`) and calls `process.disconnect()` — but Node only
 * exits once the event loop drains, and this profile has plugins that leave ref'd
 * timers behind (measured: billion-context keeps a 10 s `armRecoveryTimer`
 * interval plus a 499 ms refresh timeout, dsh-plugin-wallpaper-engine a 30 s
 * adapter-restart timer, @liustack/modlens a 5 s retry). The result is the exact
 * failure the desktop reports:
 *
 *   "Host did not complete graceful task teardown (exit null, signal SIGTERM,
 *    shutdown acknowledged true, graceful deadline exceeded true)"
 *
 * which refuses the install and leaves the update pending forever. Once the Host
 * has disconnected, its teardown is already acknowledged, so exiting is what it
 * wants; only leaked handles stand in the way. This arms one *unref'd* timer so a
 * clean loop still exits on its own first, and a leaking one is completed before
 * the desktop's 10 s deadline. No third-party plugin is modified.
 */
function installShutdownExit(ctx, delayMs) {
	if (typeof process.on !== "function") return;
	const onDisconnect = () => {
		const active = typeof process.getActiveResourcesInfo === "function"
			? process.getActiveResourcesInfo()
			: [];
		const counts = {};
		for (const resource of active) counts[resource] = (counts[resource] ?? 0) + 1;
		logSpawn(`host disconnected after shutdown; active resources ${JSON.stringify(counts)}; exit scheduled in ${delayMs} ms`);
		// unref: a drained loop exits by itself long before this fires.
		const timer = setTimeout(() => {
			logSpawn("host still alive after shutdown — exiting 0 so the desktop install can proceed");
			process.exit(0);
		}, delayMs);
		timer.unref?.();
	};
	process.on("disconnect", onDisconnect);
	ctx.effect(() => () => process.off("disconnect", onDisconnect), "dsh-quick-restart: shutdown exit");
}

/** Executable to relaunch. In the desktop Host child, execPath is the Electron exe. */
function resolveTargetExe() {
	// Documented override (tests, or a host whose execPath is not the launcher).
	const override = process.env.DSH_QUICK_RESTART_EXE;
	if (typeof override === "string" && override !== "") return override;
	const execPath = process.execPath;
	// ELECTRON_RUN_AS_NODE=1 keeps execPath pointing at DeepSeek Harness.exe, so
	// relaunching it plainly opens the app. Guard: must be an .exe on win32.
	if (process.platform === "win32" && !/\.exe$/iu.test(execPath)) return null;
	return execPath;
}

function writeJson(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > 4096) throw new Error("payload too large");
		chunks.push(chunk);
	}
	const raw = Buffer.concat(chunks).toString("utf8");
	if (raw === "") return {};
	return JSON.parse(raw);
}

/**
 * The launcher: a .cmd file, because WMI process creation takes a plain command
 * line and cannot carry an environment block. Paths are all ASCII and
 * space-free except the app exe, which is quoted here.
 */
function writeLauncher(exePath, helperArgs) {
	const argumentsText = helperArgs.map((value) => `"${value}"`).join(" ");
	const text = [
		"@echo off",
		"set \"ELECTRON_RUN_AS_NODE=1\"",
		`"${exePath}" "${HELPER}" ${argumentsText} >> "${LAUNCH_LOG}" 2>&1`,
		""
	].join("\r\n");
	writeFileSync(LAUNCH_CMD, text, "utf8");
	return LAUNCH_CMD;
}

/**
 * PowerShell program that asks WMI to create a process outside our job object.
 *
 * Two details are load-bearing, both measured on Windows 11 / PowerShell 5.1:
 *   • ProcessStartupInformation with ShowWindow = 0 (SW_HIDE) is what makes the
 *     restart invisible. A bare Create puts a console window on screen for the
 *     whole run — that is the black cmd box users see.
 *   • The startup instance must come from `[wmiclass]'Win32_ProcessStartup'`,
 *     and Create needs a REAL working directory. The CIM cmdlets cannot build
 *     that class ("no defined key" / type mismatch) and Create answers 21
 *     (WBEM_E_INVALID_PARAMETER) for a $null cwd or for CreateFlags
 *     CREATE_NO_WINDOW. ShowWindow alone, with $env:SystemRoot, returns 0.
 * Every step is best-effort: if the hidden route is unavailable we still create
 * the process the visible way, because a window beats a restart that never runs.
 */
function wmiProgram(launcherPath) {
	const commandLine = `cmd.exe /c "${launcherPath}"`.replace(/'/gu, "''");
	return [
		"$ErrorActionPreference = 'Stop'",
		`$commandLine = '${commandLine}'`,
		"$processClass = $null",
		"try { $processClass = [wmiclass]'Win32_Process' } catch { $processClass = $null }",
		"$result = $null",
		"$hiddenStartup = 0",
		"if ($null -ne $processClass) { try { $startup = ([wmiclass]'Win32_ProcessStartup').CreateInstance(); $startup.ShowWindow = 0; $candidate = $processClass.Create($commandLine, $env:SystemRoot, $startup); if ($null -ne $candidate -and $candidate.ReturnValue -eq 0) { $result = $candidate; $hiddenStartup = 1 } } catch { $result = $null; $hiddenStartup = 0 } }",
		"if ($null -eq $result) { $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine } }",
		"if ($null -eq $result) { Write-Output 'wmi-error null'; exit 2 }",
		"if ($result.ReturnValue -ne 0) { Write-Output ('wmi-error ' + $result.ReturnValue); exit 2 }",
		"Write-Output ('wmi-ok ' + $result.ProcessId + ' hidden=' + $hiddenStartup)"
	].join("; ");
}

/**
 * Launch the launcher through WMI. Runs PowerShell with PIPES (a pipe-attached
 * PowerShell starts fine; only the console-less detached form is broken), which
 * also lets us report a real error to the client instead of guessing.
 */
function launchOutsideJob(launcherPath, timeoutMs = 20_000) {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(POWERSHELL, [
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-Command",
				wmiProgram(launcherPath)
			], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, cwd: PLUGIN_DIR });
		} catch (error) {
			resolve({ ok: false, error: `spawn threw: ${String(error)}` });
			return;
		}
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		const timer = setTimeout(() => {
			try { child.kill(); } catch {}
			resolve({ ok: false, error: `timeout after ${timeoutMs}ms` });
		}, timeoutMs);
		child.once("error", (error) => {
			clearTimeout(timer);
			resolve({ ok: false, error: String(error) });
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			const match = /wmi-ok\s+(\d+)/u.exec(stdout);
			if (code === 0 && match !== null) {
				resolve({ ok: true, pid: Number(match[1]), detail: stdout.trim() });
				return;
			}
			resolve({
				ok: false,
				error: `exit=${code} stdout=${stdout.trim()} stderr=${stderr.trim()}`
			});
		});
	});
}

/**
 * Fallback (no WMI): spawn the helper detached. `spawn()` does NOT throw on
 * ENOENT — it emits an asynchronous 'error' event, so success is only reported
 * once the 'spawn'/'error' race settles.
 */
function spawnDetached(exePath, helperArgs) {
	const child = spawn(process.execPath, [HELPER, ...helperArgs], {
		env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
		detached: true,
		stdio: "ignore",
		windowsHide: true,
		cwd: PLUGIN_DIR
	});
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve({ ok: true, pid: child.pid, detail: "assumed" }), 2000);
		child.once("spawn", () => {
			clearTimeout(timer);
			resolve({ ok: true, pid: child.pid, detail: "spawned" });
		});
		child.once("error", (error) => {
			clearTimeout(timer);
			resolve({ ok: false, error: String(error) });
		});
	});
}

function apply(ctx, config) {
	const exePath = resolveTargetExe();
	const helperExists = existsSync(HELPER);
	const configured = typeof config?.gracefulSeconds === "number" && config.gracefulSeconds > 0
		? Math.min(Math.floor(config.gracefulSeconds), 30)
		: 3;
	const armDelayMs = typeof config?.armDelayMs === "number" && config.armDelayMs >= 0
		? Math.min(Math.floor(config.armDelayMs), 10_000)
		: DEFAULT_ARM_DELAY_MS;
	// How long to wait after `disconnect` before completing the Host's exit. The
	// desktop gives the child 10 s; 2 s keeps a wide margin while still letting a
	// clean loop exit naturally first (the timer is unref'd).
	const shutdownExitMs = typeof config?.shutdownExitMs === "number" && config.shutdownExitMs >= 0
		? Math.min(Math.floor(config.shutdownExitMs), 9_000)
		: 2_000;
	let arming = false;

	installShutdownExit(ctx, shutdownExitMs);

	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/quick-restart/api",
		handler: async (req, res) => {
			if (req.method !== "POST") {
				writeJson(res, 405, { ok: false, error: { code: "method-error", message: "method not allowed" } });
				return;
			}
			const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
			const method = pathname.startsWith("/quick-restart/api/")
				? pathname.slice("/quick-restart/api/".length)
				: undefined;
			if (method === undefined || method.includes("/")) {
				writeJson(res, 404, { ok: false, error: { code: "not-found", message: "unknown quick-restart API method" } });
				return;
			}
			let body = {};
			try {
				body = await readJsonBody(req);
			} catch {}

			if (method === "status") {
				const pending = pendingUpdate(exePath);
				writeJson(res, 200, {
					ok: true,
					value: {
						armed: arming,
						exe: exePath,
						image: exePath === null ? null : basename(exePath),
						helper: HELPER,
						helperExists,
						gracefulSeconds: configured,
						armDelayMs,
						launcher: LAUNCH_CMD,
						powershell: POWERSHELL,
						pendingUpdate: pending
					}
				});
				return;
			}
			if (method === "logs") {
				writeJson(res, 200, {
					ok: true,
					value: {
						spawnLog: SPAWN_LOG,
						helperLog: HELPER_LOG,
						launchLog: LAUNCH_LOG,
						scriptLog: SCRIPT_LOG,
						spawn: tail(SPAWN_LOG, 40),
						helper: tail(HELPER_LOG, 80),
						launch: tail(LAUNCH_LOG, 40),
						helperSize: (() => {
							try {
								return statSync(HELPER_LOG).size;
							} catch {
								return null;
							}
						})()
					}
				});
				return;
			}
			if (method !== "restart") {
				writeJson(res, 404, { ok: false, error: { code: "not-found", message: `unknown method "${method}"` } });
				return;
			}
			if (exePath === null) {
				writeJson(res, 500, {
					ok: false,
					error: { code: "no-exe", message: `cannot relaunch: execPath "${process.execPath}" is not a Windows exe` }
				});
				return;
			}
			if (!helperExists) {
				writeJson(res, 500, {
					ok: false,
					error: { code: "no-helper", message: `restart helper missing: ${HELPER}` }
				});
				return;
			}
			const dryRun = body !== null && typeof body === "object" && body.dryRun === true;
			const force = body !== null && typeof body === "object" && body.force === true;
			// Refuse only while an update that is NOT yet installed waits to install:
			// only the official quitAndInstall flow can apply it, and our force-kill
			// would consume the pending state without ever installing it.
			const pending = pendingUpdate(exePath);
			if (pending !== null && pending.stale !== true && !force && !dryRun) {
				const label = pending.version === null ? "待安装的更新" : `待安装的更新 v${pending.version}`;
				logSpawn(`restart refused: ${label} pending at ${pending.path}`);
				writeJson(res, 409, {
					ok: false,
					error: {
						code: "update-pending",
						message:
							`检测到${label}。请用 DSH 官方「立即安装并重启」完成升级：` +
							"一键重启会强制结束进程，走不到更新安装流程，会导致升级装不上。",
						pendingUpdate: pending
					}
				});
				return;
			}
			if (pending !== null && pending.stale === true) {
				logSpawn(
					`ignoring stale update marker: pending v${pending.version} <= installed v${pending.currentVersion}`
				);
			}
			// Ground truth for "which client bundle is this page running?": the
			// client tags every request with its own version and detected theme.
			const clientTag =
				body !== null && typeof body === "object" && typeof body.client === "string" ? body.client : "unknown";
			const clientTheme =
				body !== null && typeof body === "object" && typeof body.theme === "string" ? body.theme : "?";
			logSpawn(`restart requested client=${clientTag} theme=${clientTheme} dryRun=${dryRun}`);
			if (arming && !dryRun) {
				writeJson(res, 200, { ok: true, value: { armed: true, already: true } });
				return;
			}
			if (!dryRun) arming = true;

			const helperArgs = [
				"--exe", exePath,
				"--graceful", String(configured),
				"--arm-delay", String(armDelayMs),
				"--log", HELPER_LOG,
				"--pending-marker", PENDING_UPDATE
			];
			if (dryRun) helperArgs.push("--dry-run");

			let launched;
			let mode = "wmi";
			try {
				const launcherPath = writeLauncher(exePath, helperArgs);
				logSpawn(`launcher written ${launcherPath} helper=${HELPER} exe=${exePath} graceful=${configured}${dryRun ? " dryRun" : ""}`);
				launched = await launchOutsideJob(launcherPath);
			} catch (error) {
				launched = { ok: false, error: `launcher error: ${String(error)}` };
			}
			if (!launched.ok) {
				logSpawn(`wmi launch failed (${launched.error}) — falling back to a direct detached spawn`);
				mode = "direct";
				launched = await spawnDetached(exePath, helperArgs);
			}

			if (!launched.ok) {
				if (!dryRun) arming = false;
				logSpawn(`launch failed mode=${mode} error=${launched.error}`);
				writeJson(res, 500, { ok: false, error: { code: "launch-failed", message: String(launched.error) } });
				return;
			}

			logSpawn(`launched mode=${mode} pid=${launched.pid} detail=${launched.detail} helper=${HELPER} exe=${exePath}`);
			// Allow a retry if the app is somehow still alive a minute later.
			if (!dryRun) setTimeout(() => { arming = false; }, 60_000).unref?.();
			writeJson(res, 200, {
				ok: true,
				value: {
					armed: !dryRun,
					dryRun,
					mode,
					pid: launched.pid,
					helper: HELPER,
					helperLog: HELPER_LOG
				}
			});
		}
	}), "dsh-quick-restart: restart route");

	ctx.logger?.info?.(
		"dsh-quick-restart: route mounted on /quick-restart/api (exe %s, helper %s, present %s)",
		exePath ?? "<unresolved>",
		HELPER,
		helperExists
	);
}

// `readAppVersion` / `compareVersion` / `pendingUpdate` are exported for the
// regression test (scripts/test-update-guard.cjs); cordis only uses the default.
export { apply, compareVersion, inject, name, pendingUpdate, readAppVersion };
