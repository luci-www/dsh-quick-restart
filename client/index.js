/**
 * dsh-quick-restart — Client half.
 *
 * Loaded through the standard DSH client-plugin channel: package.json declares
 * `exports["./client"]` plus `dsh.client = { inject: [...], platform: "web" }`,
 * and this file is a `window.__ModuleLoader__.load({ id, factory })` bundle —
 * the exact shape dsh-mcp-connector and dsh-better-sidebar ship.
 *
 * UI placement (v0.4): a row in `sidebar.panellist` directly under the shipped
 * 「插件」 entry (order 1), addressing a `main` panel that owns the restart
 * action, the live status and the recent helper log.
 *
 * WHY NOT THE BRAND ROW ANY MORE: v0.3 registered into `sidebar.brand.name`
 * with `priority: -1`, which SHADOWS the official wordmark cell. The slot is
 * `kind: "single"`, so exactly one live registration renders, and shadowing the
 * official brand plugin is needless risk for zero benefit. `sidebar.panellist`
 * is the seat the shell itself documents for panel-selector rows: it draws the
 * button and `ctx.layout.selectPanel(id)` opens the `main` panel whose `key`
 * equals that id.
 */
window.__ModuleLoader__.load({
	id: "dsh-quick-restart",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");

		/** Client services this half consumes: the slot system. */
		const inject = ["slots"];

		const API_BASE = "quick-restart/api/";
		const PANEL_ID = "quick-restart";
		const STYLE_ID = "dsh-quick-restart-style";
		/**
		 * Bumped whenever this file changes in a user-visible way. It rides along
		 * with every restart request and lands in the host's spawn log, so that log
		 * alone answers "which client bundle is the page really running?".
		 */
		const CLIENT_VERSION = "13";
		/** If the app is still alive this long after arming, say so. */
		const STUCK_AFTER_MS = 20000;
		/** 409 "update-pending" is terminal for this attempt: never retried. */
		const UPDATE_PENDING = "update-pending";
		/**
		 * The desktop shell answers a bare 503 to EVERY request while an update
		 * task holds request admission (`installDesktopUpdateTaskControl` in
		 * dsh-desktop-host writes `writeHead(503)` and nothing else). The plugin's
		 * route is never reached, so retrying is the only correct response.
		 */
		const RETRYABLE_STATUSES = [429, 502, 503, 504];
		const RETRY_ATTEMPTS = 6;
		const RETRY_BASE_MS = 800;

		const CSS = [
			".dshQrPanel{display:flex;flex-direction:column;gap:14px;padding:18px 20px;box-sizing:border-box;max-width:760px;color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:1.6}",
			".dshQrTitle{display:flex;align-items:center;gap:9px;margin:0;font-size:16px;font-weight:600}",
			".dshQrHint{margin:0;color:var(--dsw-alias-label-secondary,inherit)}",
			".dshQrCard{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:12px;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.28));background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08))}",
			".dshQrRow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
			".dshQrPrimary{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:9px;border:1px solid transparent;background:#2f6feb;color:#fff;font:inherit;font-size:13px;font-weight:500;cursor:pointer}",
			".dshQrPrimary:hover:not(:disabled){filter:brightness(1.08)}",
			".dshQrPrimary:disabled{opacity:.55;cursor:default}",
			".dshQrGhost{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.35));background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}",
			".dshQrGhost:hover:not(:disabled){background:rgba(127,127,127,.14)}",
			".dshQrMeta{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}",
			".dshQrMetaKey{opacity:.75}",
			".dshQrMetaVal{font-family:ui-monospace,Consolas,monospace;word-break:break-all}",
			".dshQrWarn{display:flex;gap:8px;padding:10px 12px;border-radius:9px;border:1px solid rgba(231,185,84,.5);background:rgba(231,185,84,.12);color:#e7b954;font-size:12px}",
			".dshQrErr{color:#ff8078}",
			".dshQrOk{color:#3fb950}",
			".dshQrLog{margin:0;max-height:220px;overflow:auto;padding:10px 12px;border-radius:9px;background:rgba(0,0,0,.24);color:var(--dsw-alias-label-secondary,inherit);font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all}",
			".dshQrSpin{animation:dshQrSpin 1s linear infinite}",
			"@keyframes dshQrSpin{to{transform:rotate(360deg)}}",
			".dshQrBackdrop{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.42)}",
			".dshQrDialog{width:min(430px,calc(100vw - 48px));box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:22px;border-radius:14px;border:1px solid var(--dsh-qr-border,rgba(127,127,127,.35));background:var(--dsh-qr-card,#1f2126);color:var(--dsh-qr-text,#f4f5f7);-webkit-text-fill-color:var(--dsh-qr-text,#f4f5f7);box-shadow:0 18px 48px rgba(0,0,0,.42)}",
			".dshQrDialog h3{display:flex;align-items:center;gap:9px;margin:0;font-size:15px;font-weight:600;color:var(--dsh-qr-text,#f4f5f7);-webkit-text-fill-color:var(--dsh-qr-text,#f4f5f7)}",
			".dshQrDialog p{margin:0;font-size:13px;line-height:1.65;color:var(--dsh-qr-sub,#b3b9c2);-webkit-text-fill-color:var(--dsh-qr-sub,#b3b9c2)}",
			".dshQrMsg{min-height:16px;font-size:12px;line-height:1.5;color:var(--dsh-qr-sub,#b3b9c2)}",
			'.dshQrMsg[data-phase="error"]{color:var(--dsh-qr-error,#ff8078)}',
			'.dshQrMsg[data-phase="stuck"]{color:var(--dsh-qr-warn,#e7b954)}',
			".dshQrActions{display:flex;justify-content:flex-end;gap:8px}",
			".dshQrCancel{padding:7px 14px;border-radius:9px;border:1px solid var(--dsh-qr-border,rgba(127,127,127,.4));background:transparent;color:var(--dsh-qr-text,#f4f5f7);-webkit-text-fill-color:var(--dsh-qr-text,#f4f5f7);font:inherit;font-size:13px;cursor:pointer}",
			".dshQrCancel:disabled,.dshQrPrimary:disabled{opacity:.55;cursor:default}",
			".dshQrSection{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:12px;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.28));background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08))}",
			".dshQrSectionHead{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}",
			".dshQrSectionTitle{font-size:14px;font-weight:600}",
			".dshQrCount{font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}",
			".dshQrList{display:flex;flex-direction:column;gap:6px;max-height:320px;overflow:auto;margin:0;padding:0;list-style:none}",
			".dshQrItem{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;border:1px solid transparent;background:rgba(127,127,127,.08)}",
			'.dshQrItem[data-locked="true"]{opacity:.62}',
			".dshQrItemName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Consolas,monospace;font-size:12px}",
			".dshQrTag{flex:none;padding:1px 7px;border-radius:99px;border:1px solid rgba(127,127,127,.4);font-size:11px;color:var(--dsw-alias-label-secondary,inherit)}",
			'.dshQrTag[data-state="on"]{border-color:rgba(63,185,80,.55);color:#3fb950}',
			'.dshQrTag[data-state="off"]{border-color:rgba(127,127,127,.45)}',
			'.dshQrTag[data-state="lock"]{border-color:rgba(231,185,84,.5);color:#e7b954}',
			".dshQrToggle{flex:none;position:relative;width:34px;height:19px;padding:0;border-radius:99px;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.45));background:rgba(127,127,127,.28);cursor:pointer;transition:background .15s ease}",
			".dshQrToggle:disabled{cursor:default;opacity:.5}",
			'.dshQrToggle[data-on="true"]{background:#2f6feb;border-color:#2f6feb}',
			'.dshQrToggle::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;transition:transform .15s ease}',
			'.dshQrToggle[data-on="true"]::after{transform:translateX(15px)}',
			".dshQrInline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}",
		].join("\n");

		function installStyles() {
			if (document.getElementById(STYLE_ID) !== null) return () => {};
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = CSS;
			document.head.append(style);
			return () => {
				style.remove();
			};
		}

		/** Same-origin API URL, robust to a reverse-proxy base path. */
		function apiHref(method) {
			const base = new URL(document.baseURI || window.location.href);
			base.search = "";
			base.hash = "";
			if (!base.pathname.endsWith("/")) base.pathname += "/";
			base.pathname += API_BASE + method;
			return base.href;
		}

		function statusMessage(status) {
			if (status === 503) return "应用正在准备更新或安装，请求被暂时锁定（HTTP 503）。等更新完成后重试即可。";
			if (status === 502 || status === 504) return "宿主暂时无响应（HTTP " + status + "），请稍后重试。";
			if (status === 429) return "请求过于频繁（HTTP 429），请稍后重试。";
			return "HTTP " + status;
		}

		const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

		/** One POST, surfacing the structured error code the Node half returns. */
		async function postJson(method, payload) {
			const response = await fetch(apiHref(method), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload ?? {}),
			});
			const parsed = await response.json().catch(() => null);
			if (!response.ok || parsed === null || parsed.ok !== true) {
				const code = parsed && parsed.error && parsed.error.code ? parsed.error.code : statusMessage(response.status);
				const error = new Error(
					parsed && parsed.error && parsed.error.message ? parsed.error.message : statusMessage(response.status),
				);
				error.code = code;
				error.pendingUpdate = parsed && parsed.error ? parsed.error.pendingUpdate : undefined;
				throw error;
			}
			return parsed.value;
		}

		/**
		 * POST the restart request, retrying while the desktop shell holds its
		 * update admission lock (bare 503) or the connection drops mid-update.
		 * `onRetry` receives (attempt, status) so the dialog can explain the wait.
		 */
		async function requestRestart(onRetry) {
			for (let attempt = 1; ; attempt += 1) {
				let response;
				try {
					response = await fetch(apiHref("restart"), {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ client: CLIENT_VERSION }),
					});
				} catch (error) {
					if (attempt >= RETRY_ATTEMPTS) throw error;
					if (onRetry) onRetry(attempt, 0);
					await wait(RETRY_BASE_MS * attempt);
					continue;
				}
				if (RETRYABLE_STATUSES.includes(response.status) && attempt < RETRY_ATTEMPTS) {
					if (onRetry) onRetry(attempt, response.status);
					await wait(RETRY_BASE_MS * attempt);
					continue;
				}
				const parsed = await response.json().catch(() => null);
				if (!response.ok || parsed === null || parsed.ok !== true) {
					const detail =
						parsed && parsed.error && parsed.error.message
							? parsed.error.message
							: statusMessage(response.status);
					const error = new Error(detail);
					error.code = parsed && parsed.error ? parsed.error.code : undefined;
					error.pendingUpdate = parsed && parsed.error ? parsed.error.pendingUpdate : undefined;
					throw error;
				}
				return parsed.value;
			}
		}

		/** Tiny shared store: the panel and the shell overlay are separate cells. */
		const store = (() => {
			let state = { open: false, phase: "idle", message: "" };
			const listeners = new Set();
			let stuckTimer = null;
			const clearStuck = () => {
				if (stuckTimer !== null) {
					clearTimeout(stuckTimer);
					stuckTimer = null;
				}
			};
			const emit = () => {
				for (const listener of Array.from(listeners)) {
					try {
						listener();
					} catch (error) {
						console.warn("[dsh-quick-restart] listener failed", error);
					}
				}
			};
			const api = {
				get: () => state,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				patch(next) {
					state = { ...state, ...next };
					emit();
				},
				isBusy: () => state.phase === "arming" || state.phase === "armed",
				open() {
					if (api.isBusy()) return;
					clearStuck();
					api.patch({ open: true, phase: "idle", message: "" });
				},
				close() {
					if (api.isBusy()) return;
					clearStuck();
					api.patch({ open: false, phase: "idle", message: "" });
				},
				confirm() {
					if (api.isBusy()) return;
					api.patch({ phase: "arming", message: "正在准备重启…" });
					const onRetry = (attempt, status) => {
						const reason =
							status === 503
								? "应用正在准备更新，请求被暂时锁定"
								: status === 0
									? "宿主暂时无响应"
									: "宿主暂时不可用（HTTP " + status + "）";
						api.patch({
							phase: "arming",
							message: reason + "，正在重试（" + attempt + "/" + RETRY_ATTEMPTS + "）…",
						});
					};
					requestRestart(onRetry).then(
						() => {
							api.patch({ phase: "armed", message: "应用将在约 2 秒后关闭并自动重新打开…" });
							clearStuck();
							stuckTimer = setTimeout(() => {
								stuckTimer = null;
								if (state.phase !== "armed") return;
								api.patch({
									phase: "stuck",
									message: "应用似乎仍在运行。可以再点一次「立即重启」，或手动重启应用。",
								});
							}, STUCK_AFTER_MS);
						},
						(error) => {
							api.patch({
								phase: "error",
								message:
									error && error.code === UPDATE_PENDING
										? error.message
										: "重启失败：" + (error && error.message ? error.message : String(error)),
							});
						},
					);
				},
			};
			return api;
		})();

		function useRestartState() {
			const [state, setState] = React.useState(store.get());
			React.useEffect(() => store.subscribe(() => setState(store.get())), []);
			return state;
		}

		/**
		 * Installed-bundle state, kept apart from the restart store so a long
		 * disable batch never freezes the restart dialog.
		 *
		 * `phase` ∈ idle | loading | busy | error. `busy` blocks the whole list
		 * while the host applies a change: every official setBundleEnabled call
		 * runs its own HMR transaction, and the host applies them strictly one at
		 * a time, so the UI must not fire a second batch on top.
		 */
		const pluginStore = (() => {
			let state = { phase: "idle", message: "", plugins: [], counts: null };
			const listeners = new Set();
			const emit = () => {
				for (const listener of Array.from(listeners)) {
					try {
						listener();
					} catch (error) {
						console.warn("[dsh-quick-restart] plugin listener failed", error);
					}
				}
			};
			const api = {
				get: () => state,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				patch(next) {
					state = { ...state, ...next };
					emit();
				},
			};
			return api;
		})();

		function usePluginState() {
			const [state, setState] = React.useState(pluginStore.get());
			React.useEffect(() => pluginStore.subscribe(() => setState(pluginStore.get())), []);
			return state;
		}

		/** Merge the host's answer into the list, keeping our local row order. */
		function mergePlugins(current, incoming) {
			if (!Array.isArray(incoming)) return current;
			const byName = new Map(incoming.map((row) => [row.name, row]));
			const merged = current.map((row) => (byName.has(row.name) ? { ...row, ...byName.get(row.name) } : row));
			for (const row of incoming) {
				if (!merged.some((item) => item.name === row.name)) merged.push(row);
			}
			return merged;
		}

		/**
		 * Can this panel flip the row? Bundles are toggled by adding/removing the
		 * package from `dsh.profile.bundles`, so only installed, removable,
		 * non-protected bundles qualify — and never this plugin itself, because
		 * turning it off would dispose the panel doing the asking.
		 */
		function isManageable(row) {
			return row.removable === true && !row.readOnlyReason && !row.error && row.self !== true;
		}

		/** Why a row cannot be toggled here, in three words or less. */
		function lockLabel(row) {
			if (row.self === true) return "本插件";
			if (row.error === "not-bundle") return "非插件";
			if (row.readOnlyReason === "management-required") return "核心";
			if (row.readOnlyReason) return String(row.readOnlyReason);
			return "不可关闭";
		}

		/**
		 * Ask the host to flip one or many bundles. The host validates every name
		 * against the official manager's own list before writing, so a stale row
		 * is rejected instead of half-applied.
		 */
		async function applyPluginChange(names, enabled) {
			const list = Array.isArray(names) ? names : [names];
			if (list.length === 0) return;
			pluginStore.patch({
				phase: "busy",
				message: enabled ? "正在启用插件…" : "正在停用插件…（逐个应用，请稍候）",
			});
			try {
				const value = await postJson(list.length === 1 ? "set-plugin" : "set-plugins", {
					names: list,
					enabled,
				});
				const applied = Array.isArray(value && value.applied) ? value.applied : [];
				const rejected = Array.isArray(value && value.rejected) ? value.rejected : [];
				pluginStore.patch({
					phase: "idle",
					message: describeChange(list.length, enabled, applied, rejected),
					plugins: mergePlugins(pluginStore.get().plugins, value && value.plugins),
				});
			} catch (error) {
				pluginStore.patch({
					phase: "error",
					message: (enabled ? "启用失败：" : "停用失败：") + (error && error.message ? error.message : String(error)),
				});
			}
		}

		/**
		 * Official `setBundleEnabled` answers `applied` only when the bundle's
		 * layer could be swapped live; most third-party bundles answer
		 * `restart-required`, i.e. the manifest is already clean but the layer is
		 * still loaded until the next start. Say that out loud instead of
		 * pretending the plugin is already gone.
		 */
		function describeChange(requested, enabled, applied, rejected) {
			const verb = enabled ? "启用" : "停用";
			const verbed = enabled ? "加载" : "卸下";
			const list = Array.isArray(applied) ? applied : [];
			const restart = list.filter((row) => row.application === "restart-required").length;
			const parts = [`已${verb} ${list.length} 个插件`];
			if (rejected.length > 0) {
				const shown = rejected
					.slice(0, 2)
					.map((row) => `${row.name}（${row.reason}）`)
					.join("、");
				parts.push(`${rejected.length} 个已跳过：${shown}${rejected.length > 2 ? " 等" : ""}`);
			}
			if (restart > 0) parts.push(`其中 ${restart} 个要重启一次才真正${verbed}`);
			if (requested > 1 && list.length === 0) parts.push("没有插件被改动");
			return parts.join("；") + "。";
		}

		function PluginToggle(props) {
			const row = props.row;
			const busy = props.busy === true;
			const manageable = isManageable(row);
			const on = row.enabled === true;
			return React.createElement(
				"button",
				{
					type: "button",
					className: "dshQrToggle",
					"data-on": on ? "true" : "false",
					disabled: busy || !manageable,
					title: !manageable
						? lockLabel(row) + " — 不能在这里开关"
						: on
							? "点击停用 " + row.name
							: "点击启用 " + row.name,
					"aria-label": on ? "停用 " + row.name : "启用 " + row.name,
					onClick: () => applyPluginChange([row.name], !on),
				},
			);
		}

		/** The plugin card: the profile's installed bundles, with bulk actions. */
		function PluginCard() {
			const plugins = usePluginState();
			const [loading, setLoading] = React.useState(true);
			const rows = Array.isArray(plugins.plugins) ? plugins.plugins : [];
			const manageable = rows.filter(isManageable);
			const enabledManageable = manageable.filter((row) => row.enabled === true);
			const busy = plugins.phase === "busy";

			const refresh = React.useCallback(() => {
				setLoading(true);
				postJson("plugins")
					.then((value) => {
						const list = value && Array.isArray(value.plugins) ? value.plugins : [];
						pluginStore.patch({
							phase: "idle",
							message: "",
							plugins: list,
							counts: value && value.counts ? value.counts : null,
						});
					})
					.catch((error) => {
						pluginStore.patch({
							phase: "error",
							message: error && error.message ? error.message : String(error),
						});
					})
					.finally(() => setLoading(false));
			}, []);

			React.useEffect(() => {
				refresh();
			}, [refresh]);

			const onDisableAll = () => {
				if (enabledManageable.length === 0) return;
				applyPluginChange(enabledManageable.map((row) => row.name), false);
			};
			const onEnableAll = () => {
				const disabled = manageable.filter((row) => row.enabled !== true);
				if (disabled.length === 0) return;
				applyPluginChange(disabled.map((row) => row.name), true);
			};

			const counts = plugins.counts;
			return React.createElement(
				"div",
				{ className: "dshQrSection" },
				React.createElement(
					"div",
					{ className: "dshQrSectionHead" },
					React.createElement("span", { className: "dshQrSectionTitle" }, "已安装插件"),
					React.createElement(
						"span",
						{ className: "dshQrCount" },
						counts
							? `已安装 ${counts.total} 个 · 已开启 ${counts.enabled} 个 · 可开关 ${counts.toggleable} 个 · 受保护 ${counts.protected} 个`
							: `已安装 ${rows.length} 个`,
					),
				),
				React.createElement(
					"p",
					{ className: "dshQrHint" },
					"这里列出的是侧边栏「插件」页里的已安装插件。关闭只是不再加载它（把包名从 dsh.profile.bundles 摘掉），依赖仍然保留，可随时恢复；DSH 官方的核心模块与插件管理器自身不可关闭。万一侧边栏入口被一起关掉了，去「插件」页点开即可恢复。",
				),
				React.createElement(
					"div",
					{ className: "dshQrRow" },
					React.createElement(
						"button",
						{
							type: "button",
							className: "dshQrGhost",
							disabled: busy || enabledManageable.length === 0,
							onClick: onDisableAll,
						},
						busy ? "处理中…" : `一键关闭其他插件（${enabledManageable.length}）`,
					),
					React.createElement(
						"button",
						{
							type: "button",
							className: "dshQrGhost",
							disabled: busy || manageable.length === enabledManageable.length,
							onClick: onEnableAll,
						},
						`全部恢复（${manageable.length - enabledManageable.length}）`,
					),
					React.createElement(
						"button",
						{ type: "button", className: "dshQrGhost", disabled: busy || loading, onClick: refresh },
						loading ? "读取中…" : "刷新列表",
					),
				),
				plugins.phase === "error" && plugins.message !== ""
					? React.createElement("div", { className: "dshQrErr" }, plugins.message)
					: plugins.phase === "busy" && plugins.message !== ""
						? React.createElement("div", { className: "dshQrInline" }, plugins.message)
						: plugins.message !== ""
							? React.createElement("div", { className: "dshQrOk" }, plugins.message)
							: null,
				rows.length === 0
					? React.createElement("div", { className: "dshQrInline" }, loading ? "正在读取插件列表…" : "（没有读到插件）")
					: React.createElement(
							"ul",
							{ className: "dshQrList" },
							rows.map((row) =>
								React.createElement(
									"li",
									{ className: "dshQrItem", key: row.name, "data-locked": isManageable(row) ? "false" : "true" },
									React.createElement("span", { className: "dshQrItemName", title: row.description || row.name }, row.name),
									!isManageable(row)
										? React.createElement(
												"span",
												{ className: "dshQrTag", "data-state": "lock" },
												lockLabel(row),
											)
										: React.createElement(
												"span",
												{ className: "dshQrTag", "data-state": row.enabled === true ? "on" : "off" },
												row.enabled === true ? "已开启" : "已关闭",
											),
									React.createElement(PluginToggle, { row, busy }),
								),
							),
						),
			);
		}

		function RestartIcon(props) {
			const size = props && typeof props.size === "number" ? props.size : 18;
			const spinning = props && props.spin === true;
			return React.createElement(
				"svg",
				{
					width: size,
					height: size,
					viewBox: "0 0 16 16",
					fill: "none",
					"aria-hidden": "true",
					className: spinning ? "dshQrSpin" : undefined,
					style: { display: "block", flex: "none" },
				},
				React.createElement("path", {
					d: "M13.5 2.6v3.6h-3.6",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round",
				}),
				React.createElement("path", {
					d: "M13.1 6.2A5.4 5.4 0 1 0 13.4 9.6",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
				}),
			);
		}

		/** sidebar.panellist row: the host draws it and selects our main panel. */
		function SidebarRow(props) {
			const size = props && typeof props.size === "number" ? props.size : 18;
			return React.createElement(RestartIcon, { size });
		}

		/** main panel: status, the action, and the recent helper log. */
		function RestartPanel() {
			const restart = useRestartState();
			const [status, setStatus] = React.useState(null);
			const [statusError, setStatusError] = React.useState("");
			const [log, setLog] = React.useState("");
			const spinning = restart.phase === "arming" || restart.phase === "armed";

			const refresh = React.useCallback(() => {
				postJson("status")
					.then((value) => {
						setStatus(value);
						setStatusError("");
					})
					.catch((error) => setStatusError(error && error.message ? error.message : String(error)));
				postJson("logs")
					.then((value) => {
						const tail = value && typeof value.helper === "string" ? value.helper : "";
						setLog(tail.split("\n").slice(-40).join("\n"));
					})
					.catch(() => setLog(""));
			}, []);

			React.useEffect(() => {
				refresh();
				const timer = setInterval(refresh, 15000);
				return () => clearInterval(timer);
			}, [refresh]);

			// A leftover marker for the ALREADY installed build (electron-updater
			// never cleans it up) must not disable the button.
			const pending = status && status.pendingUpdate ? status.pendingUpdate : null;
			const blocking = pending !== null && pending.stale !== true ? pending : null;
			const canRestart = blocking === null;

			/** The panel never restarts on its own: it opens the shared confirmation
			 *  dialog so both entry points behave identically. */
			const onRestart = () => store.open();

			return React.createElement(
				"div",
				{ className: "dshQrPanel" },
				React.createElement(
					"h2",
					{ className: "dshQrTitle" },
					React.createElement(RestartIcon, { size: 18, spin: spinning }),
					"一键重启",
				),
				React.createElement(
					"p",
					{ className: "dshQrHint" },
					"关闭 DeepSeek Harness 并自动重新打开，实测约 2 秒。正在进行的回答会被中断，已保存的会话不受影响。",
				),
				blocking !== null
					? React.createElement(
							"div",
							{ className: "dshQrWarn" },
							React.createElement(RestartIcon, { size: 14 }),
							React.createElement(
								"span",
								null,
								"检测到待安装的更新" +
									(blocking.version ? " v" + blocking.version : "") +
									"。请用官方「立即安装并重启」完成升级 —— 强制重启走不到更新安装流程，会导致升级装不上。",
							),
						)
					: null,
				React.createElement(
					"div",
					{ className: "dshQrCard" },
					React.createElement(
						"div",
						{ className: "dshQrRow" },
						React.createElement(
							"button",
							{
								type: "button",
								className: "dshQrPrimary",
								disabled: !canRestart,
								onClick: onRestart,
							},
							React.createElement(RestartIcon, { size: 15, spin: spinning }),
							spinning ? "正在重启…" : "立即重启",
						),
						React.createElement(
							"button",
							{ type: "button", className: "dshQrGhost", onClick: refresh },
							"刷新状态",
						),
					),
					restart.phase === "error" && restart.message !== ""
						? React.createElement("div", { className: "dshQrErr" }, restart.message)
						: null,
					statusError !== "" ? React.createElement("div", { className: "dshQrErr" }, statusError) : null,
					status !== null
						? React.createElement(
								"div",
								{ className: "dshQrMeta" },
								React.createElement("span", { className: "dshQrMetaKey" }, "目标程序"),
								React.createElement("span", { className: "dshQrMetaVal" }, String(status.image ?? "—")),
								React.createElement("span", { className: "dshQrMetaKey" }, "helper"),
								React.createElement(
									"span",
									{ className: "dshQrMetaVal" },
									(status.helperExists ? "就绪 · " : "缺失 · ") + String(status.helper ?? ""),
								),
								React.createElement("span", { className: "dshQrMetaKey" }, "armDelay"),
								React.createElement("span", { className: "dshQrMetaVal" }, String(status.armDelayMs ?? "—") + " ms"),
								React.createElement("span", { className: "dshQrMetaKey" }, "待安装更新"),
								React.createElement(
									"span",
									{ className: "dshQrMetaVal" },
									pending !== null ? "v" + String(pending.version ?? "?") + "（请用官方升级）" : "无",
								),
							)
						: null,
				),
				React.createElement(PluginCard, null),
				React.createElement(
					"div",
					null,
					React.createElement("p", { className: "dshQrHint" }, "最近记录（helper 日志尾部）"),
					React.createElement("pre", { className: "dshQrLog" }, log === "" ? "（暂无记录）" : log),
				),
			);
		}

		/** shell.overlay cell: the confirmation dialog opened from the panel. */
		function ConfirmOverlay() {
			const state = useRestartState();
			const open = state.open === true;

			React.useEffect(() => {
				if (!open) return undefined;
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						event.stopPropagation();
						store.close();
					}
				};
				window.addEventListener("keydown", onKeyDown, true);
				return () => window.removeEventListener("keydown", onKeyDown, true);
			}, [open]);

			if (!open) return null;

			const busy = state.phase === "arming" || state.phase === "armed";
			return React.createElement(
				"div",
				{
					className: "dshQrBackdrop",
					onMouseDown: (event) => {
						if (event.target === event.currentTarget) store.close();
					},
				},
				React.createElement(
					"div",
					{ className: "dshQrDialog", role: "dialog", "aria-modal": "true" },
					React.createElement(
						"h3",
						null,
						React.createElement(RestartIcon, { size: 17, spin: state.phase === "arming" }),
						"重启 DeepSeek Harness？",
					),
					React.createElement(
						"p",
						null,
						"应用会关闭并自动重新打开。正在进行的回答会被中断，已保存的会话不受影响。",
					),
					React.createElement(
						"div",
						{ className: "dshQrMsg", "data-phase": state.phase },
						state.message,
					),
					React.createElement(
						"div",
						{ className: "dshQrActions" },
						React.createElement(
							"button",
							{ type: "button", className: "dshQrCancel", disabled: busy, onClick: () => store.close() },
							"取消",
						),
						React.createElement(
							"button",
							{ type: "button", className: "dshQrPrimary", disabled: busy, onClick: () => store.confirm() },
							React.createElement(RestartIcon, { size: 14, spin: state.phase === "arming" }),
							state.phase === "arming" ? "正在重启…" : "立即重启",
						),
					),
				),
			);
		}

		function installSlots(ctx) {
			// `main` must exist before the panellist row: the shell refuses to select
			// a row whose panel is missing.
			ctx.slots.inject("main", () =>
				ctx.slots.register({ name: "main", key: PANEL_ID }, RestartPanel),
			);
			// Order 1 sits immediately below the shipped 「插件」 entry (order 0).
			ctx.slots.inject("sidebar.panellist", () =>
				ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: 1, label: "一键重启" }, SidebarRow),
			);
			// The confirmation dialog, above the whole shell.
			ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register({ name: "shell.overlay", id: PANEL_ID }, ConfirmOverlay),
			);
		}

		function apply(ctx) {
			try {
				ctx.effect(() => installStyles(), "dsh-quick-restart: styles");
				installSlots(ctx);
			} catch (error) {
				console.error("[dsh-quick-restart] client apply failed:", error);
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
