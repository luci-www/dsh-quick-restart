/**
 * dsh-quick-restart — Client half.
 *
 * Loaded through the standard DSH client-plugin channel: package.json declares
 * `exports["./client"]` plus `dsh.client = { inject: [...], platform: "web" }`,
 * and this file is a `window.__ModuleLoader__.load({ id, factory })` bundle —
 * the exact shape dsh-mcp-connector and dsh-better-sidebar ship.
 *
 * UI (no panel — clicking never switches the centre column):
 *   - `sidebar.footer.action` id "quick-restart": an icon button in the
 *     sidebar foot beside Settings. We own this button's click handler.
 *   - `shell.overlay` id "quick-restart": the confirmation dialog.
 *
 * Why not `sidebar.panellist`: that seat is a *panel selector*. Its catalog
 * says "Each list id addresses the matching main panel; the sidebar owns the
 * button", and `ownerProps` is only `{ size, active }` — the host draws the
 * button and clicking it selects the matching `main` panel. A row there can
 * never be a plain action, so it necessarily opens a panel.
 * `sidebar.footer.action` is the seat for actions: "Optional actions beside
 * Settings at the sidebar foot", ownerProps `{ wide }`, click handled by us.
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

		const RESTART_PATH = "quick-restart/api/restart";
		const STYLE_ID = "dsh-quick-restart-style";
		/**
		 * Bumped whenever this file changes in a user-visible way. It rides along
		 * with every restart request and lands in the host's spawn log, so that log
		 * alone answers "which client bundle is the page really running?".
		 */
		const CLIENT_VERSION = "8";
		/** If the app is still alive this long after arming, say so. */
		const STUCK_AFTER_MS = 20000;
		/**
		 * The official wordmark, resolved once from the shared client primitives
		 * package — the very component the shipped brand plugin renders — so the
		 * sidebar keeps its real artwork while we append our own ⟳ after it.
		 * Null means those primitives are unavailable and we take the fallback seat.
		 */
		const brandWordmark = loadBrandWordmark();

		const CSS = [
			".dshQuickRestartBtn{display:inline-flex;align-items:center;gap:6px;max-width:132px;height:28px;padding:0 8px;box-sizing:border-box;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:12px;cursor:pointer}",
			".dshQuickRestartBtn:hover:not(:disabled){background:rgba(127,127,127,.16);color:var(--dsw-alias-label-primary,inherit)}",
			".dshQuickRestartBtn:disabled{opacity:.55;cursor:default}",
			".dshQuickRestartBtnLabel{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			/* The brand row: the shipped wordmark may shrink when the sidebar is
			   narrow, but our ⟳ keeps its size so it is never clipped away. */
			".dshQuickRestartBrandArt{flex:0 1 auto;min-width:0}",
			".dshQuickRestartBrandBtn{display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--dsh-qr-sub,#b3b9c2);cursor:pointer}",
			".dshQuickRestartBrandBtn:hover{background:rgba(127,127,127,.22);color:var(--dsh-qr-text,#f4f5f7)}",
			".dshQuickRestartBackdrop{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.42);pointer-events:auto}",
			/* Glyph paint is pinned twice on purpose. Inline styles (see the dialog
			   component) can be dropped when a host wrapper clones the element, and
			   an inherited `-webkit-text-fill-color` beats a plain `color` — either
			   way the copy went invisible. These !important rules are fed by the
			   --dsh-qr-* custom properties this plugin writes onto <html> from the
			   detected theme, so the dialog stays legible in every theme. */
			".dshQuickRestartCard{width:min(430px,calc(100vw - 48px));box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:22px 22px 18px;border-radius:14px;border:1px solid var(--dsh-qr-border,rgba(127,127,127,.35))!important;background:var(--dsh-qr-card,#ffffff)!important;color:var(--dsh-qr-text,#1b1d21)!important;-webkit-text-fill-color:var(--dsh-qr-text,#1b1d21)!important;box-shadow:0 18px 48px rgba(0,0,0,.32)!important}",
			".dshQuickRestartCard h3{display:flex;align-items:center;gap:9px;margin:0;font-size:15px;font-weight:600;color:var(--dsh-qr-text,#1b1d21)!important;-webkit-text-fill-color:var(--dsh-qr-text,#1b1d21)!important}",
			".dshQuickRestartCard p{margin:0;font-size:13px;line-height:1.65;color:var(--dsh-qr-sub,#5b626c)!important;-webkit-text-fill-color:var(--dsh-qr-sub,#5b626c)!important;opacity:1}",
			".dshQuickRestartMsg{min-height:16px;font-size:12px;line-height:1.5;color:var(--dsh-qr-sub,#5b626c);-webkit-text-fill-color:currentColor!important}",
			'.dshQuickRestartMsg[data-phase="error"]{color:var(--dsh-qr-error,#c0392b)!important}',
			'.dshQuickRestartMsg[data-phase="stuck"]{color:var(--dsh-qr-warn,#8a5d00)!important}',
			".dshQuickRestartRow{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}",
			".dshQuickRestartGhost{padding:7px 14px;border-radius:9px;border:1px solid var(--dsh-qr-border,rgba(127,127,127,.4));background:transparent;color:var(--dsh-qr-text,#1b1d21)!important;-webkit-text-fill-color:var(--dsh-qr-text,#1b1d21)!important;font:inherit;font-size:13px;cursor:pointer}",
			".dshQuickRestartGhost:hover:not(:disabled){background:rgba(127,127,127,.14)}",
			".dshQuickRestartPrimary{display:inline-flex;align-items:center;gap:7px;padding:7px 14px;border-radius:9px;border:1px solid transparent;background:var(--dsh-qr-brand,#2f6feb);color:#fff!important;-webkit-text-fill-color:#fff!important;font:inherit;font-size:13px;font-weight:500;cursor:pointer}",
			".dshQuickRestartPrimary:hover:not(:disabled){filter:brightness(1.08)}",
			".dshQuickRestartGhost:disabled,.dshQuickRestartPrimary:disabled{opacity:.55;cursor:default}",
			".dshQuickRestartSpin{animation:dshQuickRestartSpin 1s linear infinite}",
			"@keyframes dshQuickRestartSpin{to{transform:rotate(360deg)}}",
		].join("\\n");

		function installStyles() {
			if (document.getElementById(STYLE_ID) !== null) return () => {};
			applyPaletteVars(readPalette());
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = CSS;
			document.head.append(style);
			return () => {
				style.remove();
			};
		}

		/** Same-origin route, robust to a reverse-proxy base path. */
		function apiHref() {
			const base = new URL(document.baseURI || window.location.href);
			base.search = "";
			base.hash = "";
			if (!base.pathname.endsWith("/")) base.pathname += "/";
			base.pathname += RESTART_PATH;
			return base.href;
		}

		function requestRestart() {
			return fetch(apiHref(), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					client: CLIENT_VERSION,
					theme: readPalette().dark ? "dark" : "light",
				}),
			}).then((response) =>
				response
					.json()
					.catch(() => null)
					.then((parsed) => {
						if (!response.ok || parsed === null || parsed.ok !== true) {
							const detail =
								parsed && parsed.error && parsed.error.message
									? parsed.error.message
								: "HTTP " + response.status;
							throw new Error(detail);
						}
						return parsed.value;
					}),
			);
		}

		/** Parse "#rgb" / "#rrggbb" / "rgb(...)" / "rgba(...)" into [r,g,b]. */
		function parseColor(text) {
			const value = String(text ?? "").trim().toLowerCase();
			const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/u.exec(value);
			if (hex !== null) {
				const digits = hex[1].length === 3 ? hex[1].split("").map((d) => d + d).join("") : hex[1];
				return [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16));
			}
			const fn = /^rgba?\(\\s*([0-9.]+)[,\\s]+([0-9.]+)[,\\s]+([0-9.]+)/u.exec(value);
			if (fn !== null) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
			return null;
		}

		/**
		 * Colours are computed here, never inherited from a token.
		 *
		 * The first dialog let the text fall back to `inherit` while its own card
		 * background fell back to a hard-coded dark value: wherever the overlay
		 * sits outside the themed subtree that is dark-on-dark — literally
		 * invisible text. So read the app's real base surface, decide dark/light
		 * from its luminance, and pin BOTH foreground and background explicitly.
		 */
		function readPalette() {
			let raw = "";
			try {
				raw = getComputedStyle(document.documentElement).getPropertyValue("--dsw-alias-bg-base");
			} catch (error) {
				raw = "";
			}
			if (String(raw).trim() === "" && document.body !== null && document.body !== undefined) {
				try {
					raw = getComputedStyle(document.body).backgroundColor;
				} catch (error) {
					raw = "";
				}
			}
			const rgb = parseColor(raw);
			const dark = rgb === null ? true : (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 255000 < 0.5;
			return dark
				? {
						dark: true,
						card: "#1f2126",
						brand: "#4f8ef7",
						text: "#f4f5f7",
						sub: "#b3b9c2",
						border: "rgba(255,255,255,.18)",
						ghost: "rgba(255,255,255,.28)",
						error: "#ff8078",
						warn: "#e7b954",
					}
				: {
						dark: false,
						card: "#ffffff",
						brand: "#2f6feb",
						text: "#1b1d21",
						sub: "#5b626c",
						border: "rgba(0,0,0,.15)",
						ghost: "rgba(0,0,0,.24)",
						error: "#c0392b",
						warn: "#8a5d00",
					};
		}

		/** Custom properties the stylesheet's !important paint rules read. */
		const PALETTE_VARS = {
			"--dsh-qr-card": "card",
			"--dsh-qr-text": "text",
			"--dsh-qr-sub": "sub",
			"--dsh-qr-border": "border",
			"--dsh-qr-brand": "brand",
			"--dsh-qr-error": "error",
			"--dsh-qr-warn": "warn",
		};

		/**
		 * Publish the detected palette on <html>. Doing this in addition to the
		 * element's own inline styles means the dialog stays legible even when a
		 * host wrapper clones the element and drops its style prop — and it lets
		 * the stylesheet beat any inherited `-webkit-text-fill-color` with
		 * !important, which is what kept the copy invisible.
		 */
		function applyPaletteVars(palette) {
			const root = document.documentElement;
			if (root === null || root === undefined || root.style === undefined) return;
			if (typeof root.style.setProperty !== "function") return;
			for (const [name, key] of Object.entries(PALETTE_VARS)) {
				const value = palette[key];
				if (value === null || value === undefined || String(value) === "") continue;
				try {
					root.style.setProperty(name, String(value));
				} catch (error) {
					// A read-only style object must never break the dialog.
				}
			}
		}

		/** Set once the shell.overlay seat really exists (see store.open fallback). */
		let overlaySeatReady = false;

		/**
		 * Tiny shared store: the footer button and the overlay are separate slot
		 * components, so they cannot share React state directly.
		 */
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
				/**
				 * Ask first, then restart. The styled dialog lives in shell.overlay;
				 * if that seat never materialised, fall back to the native confirm so
				 * that a click can never silently do nothing.
				 */
				open() {
					if (api.isBusy()) return;
					clearStuck();
					// Re-detect on every open: the user may have flipped the theme.
					applyPaletteVars(readPalette());
					if (!overlaySeatReady) {
						const confirmed =
							typeof window.confirm !== "function" ||
							window.confirm(
								"重启 DeepSeek Harness？\\n应用会关闭并自动重新打开，正在进行的回答会被中断。",
							);
						if (confirmed) api.confirm();
						return;
					}
					api.patch({ open: true, phase: "idle", message: "" });
				},
				/** Cancel — never allowed to interrupt an armed restart. */
				close() {
					if (api.isBusy()) return;
					clearStuck();
					api.patch({ open: false, phase: "idle", message: "" });
				},
				confirm() {
					if (api.isBusy()) return;
					api.patch({ phase: "arming", message: "正在准备重启…" });
					requestRestart().then(
						() => {
							api.patch({
								phase: "armed",
								message: "应用将在约 2 秒后关闭并自动重新打开…",
							});
							clearStuck();
							stuckTimer = setTimeout(() => {
								stuckTimer = null;
								if (state.phase !== "armed") return;
								// Still alive: let the user try again instead of lying.
							api.patch({
									phase: "stuck",
									message: "应用似乎仍在运行。可以再点一次「立即重启」，或手动重启应用。",
								});
							}, STUCK_AFTER_MS);
						},
						(error) => {
							api.patch({
								phase: "error",
								message: "重启失败：" + (error && error.message ? error.message : String(error)),
							});
						},
					);
				},
			};
			return api;
		})();

		/** Re-render on store changes. */
		function useRestartState() {
			const [state, setState] = React.useState(store.get());
			React.useEffect(
				() =>
					store.subscribe(() => {
						setState(store.get());
					}),
				[],
			);
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
					className: spinning ? "dshQuickRestartSpin" : undefined,
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

		/**
		 * sidebar.footer.action cell (ownerProps: { wide }) — the degraded seat, used
		 * only when the brand wordmark is unavailable. Icon-only in both the expanded
		 * sidebar and the 56px rail: the entry is the ⟳ glyph, never a text label.
		 */
		function SidebarAction() {
			useRestartState();
			return React.createElement(
				"button",
				{
					type: "button",
					className: "dshQuickRestartBtn",
					title: "一键重启 DeepSeek Harness",
					"aria-label": "一键重启 DeepSeek Harness",
					onClick: () => store.open(),
				},
				React.createElement(RestartIcon, { size: 18 }),
			);
		}

		/** shell.overlay cell: the confirmation dialog. */
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
				return () => {
					window.removeEventListener("keydown", onKeyDown, true);
				};
			}, [open]);

			if (!open) return null;

			const busy = state.phase === "arming" || state.phase === "armed";
			// Explicit colours (see readPalette): the dialog must stay readable in
			// both themes and wherever this overlay is mounted.
			const palette = readPalette();
			const messageColor =
				state.phase === "error" ? palette.error : state.phase === "stuck" ? palette.warn : palette.sub;
			return React.createElement(
				"div",
				{
					className: "dshQuickRestartBackdrop",
					onMouseDown: (event) => {
						if (event.target === event.currentTarget) store.close();
					},
				},
				React.createElement(
					"div",
					{
						className: "dshQuickRestartCard",
						role: "dialog",
						"aria-modal": "true",
						style: {
							background: palette.card,
							color: palette.text,
							// Belt and braces: an explicit paint colour for the glyphs
							// themselves, so no inherited `color`/`text-fill-color`
							// rule can blank the text out, and a matching color-scheme so
							// native bits (caret, selection) follow the card.
							WebkitTextFillColor: palette.text,
							colorScheme: palette.dark ? "dark" : "light",
							borderColor: palette.border,
							boxShadow: palette.dark
								? "0 18px 48px rgba(0,0,0,.5)"
								: "0 18px 48px rgba(15,23,42,.18)",
						},
					},
					React.createElement(
						"h3",
						{ style: { color: palette.text, WebkitTextFillColor: palette.text } },
						React.createElement(RestartIcon, { size: 17, spin: state.phase === "arming" }),
						"重启 DeepSeek Harness？",
					),
					React.createElement(
						"p",
						{ style: { color: palette.sub, WebkitTextFillColor: palette.sub, opacity: 1 } },
						"应用会关闭并自动重新打开。正在进行的回答会被中断，已保存的会话不受影响。",
					),
					React.createElement(
						"div",
						{
							className: "dshQuickRestartMsg",
							"data-phase": state.phase,
							style: { color: messageColor, WebkitTextFillColor: messageColor, opacity: 1 },
						},
						state.message,
					),
					React.createElement(
						"div",
						{ className: "dshQuickRestartRow" },
						React.createElement(
							"button",
							{
								type: "button",
								className: "dshQuickRestartGhost",
								disabled: busy,
								style: {
									color: palette.text,
									WebkitTextFillColor: palette.text,
									borderColor: palette.ghost,
								},
								onClick: () => store.close(),
							},
							"取消",
						),
						React.createElement(
							"button",
							{
								type: "button",
								className: "dshQuickRestartPrimary",
								disabled: busy,
								style: { color: "#ffffff", WebkitTextFillColor: "#ffffff" },
								onClick: () => store.confirm(),
							},
							React.createElement(RestartIcon, { size: 14, spin: state.phase === "arming" }),
							state.phase === "arming" ? "正在重启…" : state.phase === "stuck" ? "重试重启" : "立即重启",
						),
				),
			);
		}

		/** Resolve the shipped wordmark component, or null when it is not there. */
		function loadBrandWordmark() {
			try {
				const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
				const wordmark = primitives === null || primitives === undefined ? null : primitives.BrandWordmark;
				return typeof wordmark === "function" ? wordmark : null;
			} catch (error) {
				console.warn("[dsh-quick-restart] brand primitives unavailable, using the footer seat", error);
				return null;
			}
		}

		/**
		 * sidebar.brand.name cell: the official wordmark, then our ⟳ right after it.
		 *
		 * The shell renders this cell inside a button that starts a new session, so
		 * every pointer event on ours is swallowed — otherwise asking for a restart
		 * would also open a fresh session.
		 */
		function BrandNameRow() {
			useRestartState();
			const swallow = (event) => {
				if (event === null || event === undefined) return;
				if (typeof event.stopPropagation === "function") event.stopPropagation();
				if (typeof event.preventDefault === "function") event.preventDefault();
				};
				return React.createElement(
					React.Fragment,
					null,
					React.createElement(brandWordmark, { includeMark: false, className: "dshQuickRestartBrandArt" }),
					React.createElement(
						"button",
						{
							type: "button",
							className: "dshQuickRestartBrandBtn",
							title: "一键重启 DeepSeek Harness",
							"aria-label": "一键重启 DeepSeek Harness",
							tabIndex: -1,
							onPointerDown: swallow,
							onMouseDown: swallow,
							onClick: (event) => {
								swallow(event);
								store.open();
							},
						},
						React.createElement(RestartIcon, { size: 18 }),
					),
				);
		}

		function installSlots(ctx) {
			if (brandWordmark === null) {
				// Nothing to keep the wordmark with: fall back to the sidebar-foot
				// action so the entry still exists instead of doing nothing.
				ctx.slots.inject("sidebar.footer.action", () =>
					ctx.slots.register(
						{ name: "sidebar.footer.action", id: "quick-restart", order: 5, label: "一键重启" },
						SidebarAction,
					),
				);
			} else {
				// Preferred seat: inside the brand row, right after deepseekHARNESS.
				// The shell only mounts that row while the sidebar is expanded.
				// A `single` seat renders the LOWEST live priority, and registering
				// at a taken priority throws — the shipped brand entry sits at 0,
				// so only a negative priority shadows it.
				ctx.slots.inject("sidebar.brand.name", () =>
					ctx.slots.register({ name: "sidebar.brand.name", id: "quick-restart", priority: -1 }, BrandNameRow),
				);
			}
			// The confirmation dialog, above the whole shell.
			ctx.slots.inject("shell.overlay", () => {
					overlaySeatReady = true;
					const dispose = ctx.slots.register({ name: "shell.overlay", id: "quick-restart" }, ConfirmOverlay);
					return () => {
						overlaySeatReady = false;
						dispose();
					};
				});
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
