/**
 * Regression test for the update guard (v0.4.2).
 *
 * Bug it pins down: electron-updater leaves `pending\update-info.json` behind
 * after a SUCCESSFUL install, so a bare marker made the plugin answer 409
 * forever and permanently disabled the restart button. The guard must compare
 * the marker's version against the running build and block only a strictly
 * newer one.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { compareVersion, pendingUpdate, readAppVersion } from "../lib/index.js";

const EXE = "D:\\APP\\DeepseekH\\DeepSeek Harness.exe";
let failures = 0;
const check = (label, fn) => {
	try {
		fn();
		console.log(`PASS ${label}`);
	} catch (error) {
		failures += 1;
		console.log(`FAIL ${label}: ${error.message}`);
	}
};

check("compareVersion equal builds", () => assert.equal(compareVersion("0.2.1-rc.3", "0.2.1-rc.3"), 0));
check("compareVersion older prerelease", () => assert.ok(compareVersion("0.2.1-rc.2", "0.2.1-rc.3") < 0));
check("compareVersion newer prerelease", () => assert.ok(compareVersion("0.2.1-rc.4", "0.2.1-rc.3") > 0));
check("compareVersion minor bump", () => assert.ok(compareVersion("0.2.2", "0.2.1-rc.3") > 0));
check("compareVersion stable beats prerelease", () => assert.ok(compareVersion("0.2.1", "0.2.1-rc.3") > 0));

if (existsSync(EXE)) {
	const installed = readAppVersion(EXE);
	check(`readAppVersion returns a version (${installed})`, () => {
		assert.match(String(installed), /^\d+\.\d+\.\d+/u);
	});
	const pending = pendingUpdate(EXE);
	if (pending !== null) {
		console.log(
			`     live marker: pending v${pending.version} vs installed v${pending.currentVersion} -> stale=${pending.stale}`
		);
		check("live leftover marker is classified stale (restart allowed)", () => {
			assert.equal(pending.stale, true);
		});
	} else {
		console.log("     no pending marker present (nothing to classify)");
	}
} else {
	console.log("SKIP live checks: exe not found at " + EXE);
}

if (failures > 0) {
	console.log(`\n${failures} check(s) FAILED`);
	process.exit(1);
}
console.log("\nall checks passed");
