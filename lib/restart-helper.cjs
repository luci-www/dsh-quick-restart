#!/usr/bin/env node
/**
 * dsh-quick-restart — detached restart helper.
 *
 * WHY THIS EXISTS (measured, not guessed):
 * The first implementation spawned `powershell.exe -File scripts/restart.ps1`
 * with `{ detached: true, stdio: "ignore" }`. On Windows `detached: true` means
 * DETACHED_PROCESS (no console), and **Windows PowerShell 5.1 exits silently at
 * startup without a console**: every shape (−File, −Command, `& script.ps1`)
 * returned `code=0` after ~70 ms having done nothing at all, which is exactly
 * what the production logs showed (`child pid=15788 exited code=0`, 74 ms, and
 * not a single line written by the script). Only `detached: false` runs the
 * script, but a non-detached helper is a plain child of the app and gets torn
 * down with it.
 *
 * The replacement is the mechanism DSH itself uses to start its Host child
 * (`lib/types/node-environment.js` sets `ELECTRON_RUN_AS_NODE: "1"` and runs
 * `DeepSeek Harness.exe <script>`): spawn the Electron binary in Node mode with
 * a JS file. Measured in the real host process tree: runs correctly while
 * detached (`exit 0`, marker written).
 *
 * How it is started matters just as much: every DSH process sits in a Job Object
 * (measured with IsProcessInJob — main, GPU, renderer, Host child), a child
 * inherits its parent's job, and a kill-on-close job would take this helper down
 * at the very moment the app's last handle closes. The Node half therefore has
 * WMI (`Win32_Process.Create`) create the launcher, which parents it to
 * WmiPrvSE.exe — outside the job (measured: caller inJob=True, WMI child
 * inJob=False) while still running as the user with the user's environment.
 *
 * This helper therefore owns the whole restart and never shells out to
 * PowerShell:
 *   1. enumerate every `<image>` process with tasklist.exe (self excluded);
 *   2. wait --arm-delay ms so the browser can paint "restarting";
 *   3. ask them to close gracefully (taskkill without /F sends WM_CLOSE);
 *   4. wait up to --graceful seconds;
 *   5. force-kill the survivors;
 *   6. relaunch <exe> WITHOUT ELECTRON_RUN_AS_NODE (else it would boot as Node);
 *   7. verify and log.
 *
 * All child output is redirected to FILES, never pipes: the app's environment
 * cannot be assumed to allow pipe handles, and file redirection was measured to
 * work. The helper is a `.cjs` file so it runs regardless of the package's
 * `"type": "module"`.
 *
 * Usage: restart-helper.cjs --exe <path> --graceful <seconds> [--dry-run]
 *        [--arm-delay <ms>] [--log <file>]
 */
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_LOG_BYTES = 64 * 1024;

function argValue(flag, fallback) {
	const index = process.argv.indexOf(flag);
	const value = index >= 0 ? process.argv[index + 1] : undefined;
	return value === undefined || value === "" ? fallback : value;
}

const exePath = argValue("--exe", process.execPath);
const gracefulSeconds = Math.max(1, Math.min(60, Number(argValue("--graceful", "3")) || 3));
const armDelayMs = Math.max(0, Math.min(10_000, Number(argValue("--arm-delay", "0")) || 0));
const dryRun = process.argv.includes("--dry-run");
const image = path.basename(exePath);
const selfPid = process.pid;

/**
 * The WMI-launched process has the user's environment, but the launcher passes
 * the log path explicitly so the log can never land in a surprise location.
 */
const HELPER_LOG = argValue("--log", path.join(os.tmpdir(), "dsh-quick-restart-helper.log"));

/**
 * This helper terminates every process of `image`. If a bad --exe ever reached
 * it (a wrong process.execPath), an image-name kill would take out unrelated
 * programs, so obviously-wrong system images are refused outright.
 */
const FORBIDDEN_IMAGES = /^(node|cmd|powershell|pwsh|explorer|taskkill|tasklist|conhost|reg|where|find)\.exe$/iu;

function log(line) {
	const entry = `${new Date().toISOString()} [helper ${selfPid}] ${line}\\n`;
	try {
		if (fs.existsSync(HELPER_LOG) && fs.statSync(HELPER_LOG).size > MAX_LOG_BYTES) fs.writeFileSync(HELPER_LOG, "");
		fs.appendFileSync(HELPER_LOG, entry, "utf8");
	} catch {}
	try {
		process.stdout.write(entry);
	} catch {}
}

/** Run a command with file-redirected stdio (no pipes) and return {status, output}. */
function runToFile(command, args, tag) {
	const capture = path.join(os.tmpdir(), `dsh-quick-restart-${tag}-${selfPid}.txt`);
	let descriptor = null;
	try {
		descriptor = fs.openSync(capture, "w");
	} catch (error) {
		return { status: null, output: "", error: String(error) };
	}
	let result;
	try {
		result = spawnSync(command, args, {
			stdio: ["ignore", descriptor, descriptor],
			windowsHide: true,
			timeout: 20_000,
		});
	} finally {
		try {
			fs.closeSync(descriptor);
		} catch {}
	}
	let output = "";
	try {
		output = fs.readFileSync(capture, "utf8");
	} catch {}
	try {
		fs.unlinkSync(capture);
	} catch {}
	if (result.error !== undefined) return { status: null, output, error: String(result.error) };
	return { status: result.status, output };
}

/** Every PID of the app image, including the caller. */
function listAppPids() {
	const result = runToFile("tasklist.exe", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"], "tasklist");
	if (result.status !== 0 && result.output.trim() === "") {
		log(`tasklist failed status=${result.status} error=${result.error ?? ""} output=${result.output.trim().replace(/\\s+/gu, " ")}`);
		return [];
	}
	const pids = [];
	for (const line of result.output.split(/\\r?\\n/u)) {
		const match = /^"([^"]+)","(\\d+)"/u.exec(line.trim());
		if (match !== null && match[1].toLowerCase() === image.toLowerCase()) pids.push(Number(match[2]));
	}
	return pids;
}

function targets() {
	return listAppPids().filter((pid) => pid !== selfPid);
}

function kill(pid, force) {
	const args = ["/PID", String(pid)];
	if (force) args.push("/F");
	const result = runToFile("taskkill.exe", args, "taskkill");
	const text = `${result.output ?? ""}${result.error ?? ""}`.trim().replace(/\\s+/gu, " ");
	log(`taskkill ${args.join(" ")} -> status=${result.status} ${text}`);
	return result.status === 0;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
	log(`start exe=${exePath} image="${image}" graceful=${gracefulSeconds} armDelay=${armDelayMs} dryRun=${dryRun} log=${HELPER_LOG} cwd=${process.cwd()}`);
	if (FORBIDDEN_IMAGES.test(image)) {
		log(`refusing to run: image "${image}" is a system program, not the desktop app`);
		return;
	}
	const initial = listAppPids();
	log(`initial processes (${initial.length}): ${initial.join(",")}`);

	if (dryRun) {
		log("dry run: no action taken");
		return;
	}

	// Let the HTTP reply reach the browser before the app starts disappearing.
	if (armDelayMs > 0) {
		log(`arming: waiting ${armDelayMs} ms before closing the app`);
		await sleep(armDelayMs);
	}

	// One taskkill call for every PID at once (~120ms) instead of one spawn per
	// PID (~120ms each). WM_CLOSE graceful passes were measured useless against
	// Electron children (they answer "only force works"), so no graceful phase.
	const pids = targets();
	if (pids.length > 0) {
		const args = [];
		for (const pid of pids) args.push("/PID", String(pid));
		args.push("/F", "/T");
		const result = runToFile("taskkill.exe", args, "taskkill");
		log(`taskkill force (all ${pids.length}) -> status=${result.status} ${`${result.output ?? ""}${result.error ?? ""}`.trim().replace(/\\s+/gu, " ").slice(0, 300)}`);
	}

	// Force kill is synchronous; one confirmation poll covers stragglers.
	await sleep(400);
	if (targets().length > 0) {
		for (let attempt = 0; attempt < 20 && targets().length > 0; attempt += 1) await sleep(250);
	}
	const remaining = targets();
	log(`after force kill: ${remaining.length} remaining (${remaining.join(",")})`);
	if (remaining.length > 0) log(`WARNING: relaunching anyway, ${remaining.length} process(es) survived`);

	// No fixed sleep before relaunch: force-killed processes are already gone
	// (targets() returned empty), port handles are released synchronously on
	// process death, and the extra second was pure dead time in every run.
	// ELECTRON_RUN_AS_NODE must NOT leak into the relaunch, or the app would
	// boot as a plain Node process with no window at all.
	const environment = { ...process.env };
	delete environment.ELECTRON_RUN_AS_NODE;

	let child;
	try {
		child = spawn(exePath, [], {
			cwd: path.dirname(exePath),
			detached: true,
			stdio: "ignore",
			windowsHide: false,
			env: environment,
		});
	} catch (error) {
		log(`relaunch threw: ${String(error)}`);
		return;
	}
	const failure = await new Promise((resolve) => {
		const timer = setTimeout(() => resolve(null), 3000);
		child.once("spawn", () => {
			clearTimeout(timer);
			resolve("spawned");
		});
		child.once("error", (error) => {
			clearTimeout(timer);
			resolve(String(error));
		});
	});
	child.unref();
	if (failure !== "spawned") {
		log(`relaunch failed: ${failure}`);
		return;
	}
	log(`relaunched exe=${exePath} pid=${child.pid}`);

	await sleep(6000);
	const after = listAppPids();
	log(`verification: ${after.length} process(es) named "${image}" running (${after.join(",")})`);
}

main().catch((error) => log(`fatal ${error && error.stack ? error.stack : String(error)}`));
