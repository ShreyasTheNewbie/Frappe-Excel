/**
 * ev_ui.js — Excel View UI Component Library
 *
 * Three reusable, theme-aware components that replace Frappe's generic dialogs
 * with Excel-palette equivalents (green accent, both light + dark themes).
 *
 *   EVModal    — centered dialog with header / body / footer
 *   EVToast    — stacked toast notifications (replaces frappe.show_alert)
 *   show_error — user-friendly Frappe error presenter (replaces frappe.msgprint)
 *
 * Public API (all on frappe.views.excel):
 *   new frappe.views.excel.EVModal(opts).show()
 *   frappe.views.excel.toast(message, type, duration)
 *   frappe.views.excel.show_error(err, context)
 */

frappe.provide("frappe.views.excel");

// ─────────────────────────────────────────────────────────────────────────────
// EVModal
// ─────────────────────────────────────────────────────────────────────────────

frappe.views.excel.EVModal = class EVModal {
	/**
	 * @param {Object}   opts
	 * @param {string}   opts.title
	 * @param {string}   [opts.body_html]
	 * @param {Object[]} [opts.actions]     [{label, variant:"primary"|"danger"|"default", action}]
	 * @param {string}   [opts.size]        "sm" | "md" | "lg"   (default "md")
	 * @param {Function} [opts.on_hide]
	 */
	constructor(opts = {}) {
		this.opts     = opts;
		this._visible = false;
		this._el      = null;
		this._keydown = (e) => { if (e.key === "Escape") this.hide(); };
		this._build();
	}

	_build() {
		const size_cls = { sm: "evm--sm", lg: "evm--lg" }[this.opts.size] || "";

		this._el = document.createElement("div");
		this._el.className = "evm-overlay";
		this._el.innerHTML = `
			<div class="evm-card ${size_cls}" role="dialog" aria-modal="true">
				<div class="evm-header">
					<span class="evm-title">${frappe.utils.escape_html(this.opts.title || "")}</span>
					<button class="evm-close" aria-label="${__("Close")}">
						<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
							<path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
						</svg>
					</button>
				</div>
				<div class="evm-body">${this.opts.body_html || ""}</div>
				${this._footer_html()}
			</div>`;

		this._el.querySelector(".evm-close").addEventListener("click", () => this.hide());
		this._el.addEventListener("mousedown", (e) => { if (e.target === this._el) this.hide(); });
	}

	_footer_html() {
		const actions = this.opts.actions || [];
		if (!actions.length) return "";
		const btns = actions.map((a) => {
			const cls = {
				primary: "evm-btn evm-btn--primary",
				danger:  "evm-btn evm-btn--danger",
			}[a.variant] || "evm-btn evm-btn--default";
			return `<button class="${cls}" data-label="${frappe.utils.escape_html(a.label)}">${frappe.utils.escape_html(a.label)}</button>`;
		}).join("");
		return `<div class="evm-footer">${btns}</div>`;
	}

	show() {
		if (this._visible) return this;
		document.body.appendChild(this._el);
		document.addEventListener("keydown", this._keydown);
		// Double rAF: first frame mounts, second frame transitions
		requestAnimationFrame(() => requestAnimationFrame(() => {
			this._el.classList.add("evm-overlay--in");
		}));
		this._el.querySelectorAll("[data-label]").forEach((btn) => {
			btn.addEventListener("click", () => {
				const lbl    = btn.dataset.label;
				const action = (this.opts.actions || []).find((a) => a.label === lbl);
				action?.action?.();
			});
		});
		this._visible = true;
		return this;
	}

	hide() {
		if (!this._visible) return;
		this._visible = false;
		this._el.classList.remove("evm-overlay--in");
		document.removeEventListener("keydown", this._keydown);
		setTimeout(() => { this._el.remove(); this.opts.on_hide?.(); }, 200);
	}

	/** Replace body content */
	set_body(html) {
		const el = this._el?.querySelector(".evm-body");
		if (el) el.innerHTML = html;
		return this;
	}

	/** Replace title */
	set_title(title) {
		const el = this._el?.querySelector(".evm-title");
		if (el) el.textContent = title;
		return this;
	}

	/** Direct reference to the body DOM node */
	get_body() {
		return this._el?.querySelector(".evm-body") || null;
	}
};

// ─────────────────────────────────────────────────────────────────────────────
// EVToast  (stacked notifications — replaces frappe.show_alert)
// ─────────────────────────────────────────────────────────────────────────────

class _ToastManager {
	constructor() {
		this._container = null;
	}

	_ensure() {
		if (this._container && document.body.contains(this._container)) return;
		this._container = document.createElement("div");
		this._container.className = "evt-stack";
		document.body.appendChild(this._container);
	}

	show(message, type = "info", duration = 3500) {
		this._ensure();

		const ICONS = {
			success: `<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 8l2.2 2.2L11 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
			error:   `<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 5.2v3.2M8 10.8h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
			warning: `<svg viewBox="0 0 16 16" fill="none"><path d="M7.14 2.8L1.48 12.4A1 1 0 002.34 14h11.32a1 1 0 00.86-1.6L8.86 2.8a1 1 0 00-1.72 0z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.5v2.5M8 11h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
			info:    `<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v3.6M8 5.2h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
		};

		const el = document.createElement("div");
		el.className = `evt evt--${type}`;
		el.innerHTML = `
			<span class="evt-icon">${ICONS[type] || ICONS.info}</span>
			<span class="evt-msg">${frappe.utils.escape_html(message)}</span>
			<button class="evt-x" aria-label="${__("Dismiss")}">
				<svg viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
			</button>
			<div class="evt-bar-track"><div class="evt-bar"></div></div>`;

		this._container.appendChild(el);

		// Animate in
		requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("evt--in")));

		// Progress bar
		const bar = el.querySelector(".evt-bar");
		requestAnimationFrame(() => requestAnimationFrame(() => {
			bar.style.transitionDuration = `${duration}ms`;
			bar.style.width = "0%";
		}));

		let timer = setTimeout(() => this._out(el), duration);

		el.addEventListener("mouseenter", () => {
			clearTimeout(timer);
			const w = parseFloat(getComputedStyle(bar).width);
			const tw = parseFloat(getComputedStyle(bar.parentElement).width);
			const remaining = (w / tw) * duration;
			bar.style.transitionDuration = "0ms";
			bar.style.width = `${(w / tw) * 100}%`;
			el._remaining = remaining;
		});
		el.addEventListener("mouseleave", () => {
			const rem = el._remaining ?? 1000;
			bar.style.transitionDuration = `${rem}ms`;
			bar.style.width = "0%";
			timer = setTimeout(() => this._out(el), rem);
		});
		el.querySelector(".evt-x").addEventListener("click", () => {
			clearTimeout(timer);
			this._out(el);
		});
	}

	_out(el) {
		el.classList.remove("evt--in");
		setTimeout(() => el.remove(), 250);
	}
}

const _toast_mgr = new _ToastManager();

/**
 * Show a toast notification.
 * @param {string} message
 * @param {"success"|"error"|"warning"|"info"} [type="info"]
 * @param {number} [duration=3500]  ms before auto-dismiss
 */
frappe.views.excel.toast = (message, type = "info", duration = 3500) =>
	_toast_mgr.show(message, type, duration);

// ─────────────────────────────────────────────────────────────────────────────
// show_error  (user-friendly Frappe error presenter)
// ─────────────────────────────────────────────────────────────────────────────

/** Maps Frappe exc_type → {label, accent} where accent is a CSS class suffix */
const _EXC_MAP = {
	ValidationError:          { label: "Validation Error",        accent: "orange" },
	MandatoryError:           { label: "Required Field Missing",   accent: "orange" },
	LinkValidationError:      { label: "Invalid Link",             accent: "orange" },
	PermissionError:          { label: "Permission Denied",        accent: "red"    },
	DoesNotExistError:        { label: "Record Not Found",         accent: "red"    },
	DuplicateEntryError:      { label: "Duplicate Entry",          accent: "orange" },
	DocstatusTransitionError: { label: "Document State Error",     accent: "orange" },
	TimestampMismatchError:   { label: "Concurrent Edit Conflict", accent: "yellow" },
	UniqueValidationError:    { label: "Duplicate Entry",          accent: "orange" },
};

/**
 * Extract the human-readable message from a Frappe API error response.
 * Priority: _server_messages → last line of exc → generic fallback.
 */
function _parse_frappe_error(err) {
	// 1 — _server_messages is the most user-friendly source
	try {
		const raw = err?._server_messages;
		if (raw) {
			const msgs = JSON.parse(raw);
			const parts = msgs.map((m) => {
				const obj = typeof m === "string" ? JSON.parse(m) : m;
				return (obj.message || "").replace(/<[^>]*>/g, "").trim();
			}).filter(Boolean);
			if (parts.length) return parts.join("\n");
		}
	} catch (_) {}

	// 2 — Last non-blank line of the traceback (the actual error text)
	const exc = err?.exc || err?.message || "";
	if (exc) {
		const lines = exc.trim().split("\n").filter((l) => l.trim());
		const last  = lines[lines.length - 1] || "";
		// Strip "ExceptionClass: " prefix
		const msg = last.replace(/^[\w.]+Error:\s*/i, "").trim();
		if (msg) return msg;
	}

	return __("An unexpected error occurred.");
}

/**
 * Show a user-friendly error dialog.
 * @param {Object|string} err     Frappe API error response or plain string
 * @param {string}        [context]  Brief sentence describing what was attempted
 */
frappe.views.excel.show_error = function(err, context = "") {
	const is_string  = typeof err === "string";
	const exc_type   = is_string ? "" : (err?.exc_type || "");
	const meta       = _EXC_MAP[exc_type] || { label: __("Error"), accent: "red" };
	const user_msg   = is_string ? err : _parse_frappe_error(err);
	const tb         = is_string ? "" : (err?.exc || "");

	const ctx_html = context
		? `<p class="eve-context">${frappe.utils.escape_html(context)}</p>`
		: "";

	const tb_html = tb
		? `<details class="eve-details">
				<summary>${__("Technical details")}</summary>
				<pre class="eve-trace">${frappe.utils.escape_html(tb.trim())}</pre>
			</details>`
		: "";

	const body = `
		<div class="eve-body">
			<div class="eve-badge eve-badge--${meta.accent}">${frappe.utils.escape_html(__(meta.label))}</div>
			<p class="eve-msg">${frappe.utils.escape_html(user_msg)}</p>
			${ctx_html}
			${tb_html}
		</div>`;

	const modal = new frappe.views.excel.EVModal({
		title:     __("Could not complete action"),
		body_html: body,
		size:      "sm",
		actions:   [{ label: __("Close"), variant: "default", action() { modal.hide(); } }],
	});
	modal.show();
};
