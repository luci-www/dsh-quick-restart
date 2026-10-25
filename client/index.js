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
		const CLIENT_VERSION = "10";
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

			const pending = status && status.pendingUpdate ? status.pendingUpdate : null;
			const canRestart = !pending;

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
				pending !== null
					? React.createElement(
							"div",
							{ className: "dshQrWarn" },
							React.createElement(RestartIcon, { size: 14 }),
							React.createElement(
								"span",
								null,
								"检测到待安装的更新" +
									(pending.version ? " v" + pending.version : "") +
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
