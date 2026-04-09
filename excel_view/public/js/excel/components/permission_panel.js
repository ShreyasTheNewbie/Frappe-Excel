/**
 * permission_panel.js — v2
 *
 * UX redesign:
 *   • New header: gradient, "Access Management" title, DocType subtitle,
 *     animated status badge (Live / Saving… / Error)
 *   • HOT grid: READ / ⚠ DANGER ZONE / ADVANCED column groups via header
 *     color coding + data cell tinting; column tooltips via title=""
 *   • Role cell: shows user count + remove (×) button inline
 *   • Role search: real-time filter with empty state illustration
 *   • Green flash: cell briefly turns green after a successful save
 *   • Field Levels tab: searchable list with inline permlevel select
 *
 * All writes still go through excel_view.api → Frappe canonical APIs.
 */

frappe.provide("frappe.views.excel");

// ── Constants ─────────────────────────────────────────────────────────────────

const PERM_FLAGS = [
	"read", "write", "create",
	"delete", "submit", "cancel", "amend",
	"report", "export", "import", "share", "print", "email",
];

const _READ_FLAGS   = new Set(["read", "write", "create"]);
const _DANGER_FLAGS = new Set(["delete", "submit", "cancel", "amend"]);
// everything else → ADVANCED group

// 2-char abbreviations that fit inside narrow checkbox columns
const _FLAG_ABBR = {
	read: "Rd", write: "Wr", create: "Cr",
	delete: "Dl", submit: "Sb", cancel: "Cn", amend: "Am",
	report: "Rp", export: "Ex", import: "Im", share: "Sh", print: "Pr", email: "Em",
};

// Full labels for tooltip title=""
const _FLAG_TIPS = {
	read:   "Read — view records of this DocType",
	write:  "Write — edit existing records",
	create: "Create — create new records",
	delete: "Delete — permanently delete records",
	submit: "Submit — lock a document",
	cancel: "Cancel — cancel a submitted document",
	amend:  "Amend — re-open a cancelled document",
	report: "Report — run and view reports",
	export: "Export — export records to CSV / Excel",
	import: "Import — import records from file",
	share:  "Share — share documents with other users",
	print:  "Print — print / download PDFs",
	email:  "Email — send emails from a document",
};

const PERM_COLS = [
	{ data: "role",      title: "Role",  type: "text",    width: 152, readOnly: true },
	{ data: "permlevel", title: "Lvl",   type: "numeric", width: 30,  readOnly: true },
	...PERM_FLAGS.map(f => ({
		data: f,
		title: _FLAG_ABBR[f],
		type: "checkbox",
		checkedTemplate: 1,
		uncheckedTemplate: 0,
		width: 34,
	})),
];

const COL_IDX = {};
PERM_COLS.forEach((c, i) => { COL_IDX[c.data] = i; });

// ── Class ─────────────────────────────────────────────────────────────────────

frappe.views.excel.PermissionPanel = class PermissionPanel {
	constructor({ board, toolbar }) {
		this.board        = board;
		this.toolbar      = toolbar;
		this._hot         = null;
		this._data        = [];    // raw rows from get_doctype_permissions
		this._roles       = [];    // all available roles for "Add" dropdown
		this._fields      = [];    // field permlevel data
		this._role_counts = {};    // {role: user_count}
		this._grid_data   = [];    // current HOT grid data (filtered or full)
		this._timers      = {};    // debounce timers
		this._pending     = 0;     // in-flight save count
		this._flashing    = new Set(); // "row:col" cells currently flashing green
		this.$panel       = null;
		this._active_tab  = "roles";
	}

	// ── Public API ────────────────────────────────────────────────────────────

	build_panel_dom() {
		this.$panel = $(this._panel_html());
		this._bind_panel_events();
		return this.$panel;
	}

	on_opened() {
		this._load_data();
	}

	destroy() {
		this._destroy_hot();
		this.$panel = null;
		this._data  = [];
		this._roles = [];
		this._flashing.clear();
	}

	// ── HTML ──────────────────────────────────────────────────────────────────

	_panel_html() {
		const dt = frappe.utils.escape_html(this.board.doctype);
		return `
		<div class="ev-rs-panel ev-perm-panel" data-rs-panel="permissions">

			<!-- ── Header ──────────────────────────────────────────────── -->
			<div class="ev-perm-hdr">
				<div class="ev-perm-hdr-icon">
					<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
						<path d="M8 1a4 4 0 0 1 4 4v1h1a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h1V5a4 4 0 0 1 4-4zm3 5V5a3 3 0 0 0-6 0v1h6zm-3 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>
					</svg>
				</div>
				<div class="ev-perm-hdr-text">
					<div class="ev-perm-hdr-title">${__("Access Management")}</div>
					<div class="ev-perm-hdr-sub">${dt}</div>
				</div>
				<div class="ev-perm-badge" data-state="loading">
					<span class="ev-perm-badge-dot"></span>
					<span class="ev-perm-badge-label">${__("Loading")}</span>
				</div>
				<button class="ev-rs-close" title="${__("Close")}">
					<svg width="11" height="11" viewBox="0 0 12 12" fill="none"
						stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
						<line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/>
					</svg>
				</button>
			</div>

			<!-- ── Tabs ─────────────────────────────────────────────────── -->
			<div class="ev-perm-tabs">
				<div class="ev-perm-tab ev-perm-tab--active" data-tab="roles">${__("Role Permissions")}</div>
				<div class="ev-perm-tab" data-tab="fields">${__("Field Levels")}</div>
			</div>

			<!-- ── Tab 1: Role Permissions ──────────────────────────────── -->
			<div class="ev-perm-pane ev-perm-pane--active" data-pane="roles">
				<!-- Search bar -->
				<div class="ev-perm-search-bar">
					<svg class="ev-perm-search-icon" width="13" height="13" viewBox="0 0 16 16"
						fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
						<circle cx="6.5" cy="6.5" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>
					</svg>
					<input class="ev-perm-role-search" type="text"
						placeholder="${__("Search roles…")}">
					<button class="ev-perm-search-clear" style="display:none" title="${__("Clear")}">×</button>
				</div>

				<!-- HOT grid -->
				<div class="ev-perm-hot-wrap"></div>

				<!-- Empty state (shown when search finds nothing) -->
				<div class="ev-perm-empty-state" style="display:none">
					<svg width="40" height="40" viewBox="0 0 40 40" fill="none"
						stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
						<circle cx="20" cy="20" r="16" stroke-dasharray="4 3" opacity="0.4"/>
						<path d="M14 20h12M20 14v12" opacity="0.3"/>
						<circle cx="20" cy="20" r="5" opacity="0.5"/>
					</svg>
					<p>${__("No roles match your search")}</p>
				</div>

				<!-- Add role row -->
				<div class="ev-perm-add-row">
					<div class="ev-perm-role-ac-wrap">
						<input type="text" class="ev-perm-role-sel" placeholder="${__("Search role…")}" autocomplete="off" spellcheck="false">
					</div>
					<select class="ev-perm-lvl-sel" title="${__("Permission Level")}">
						${[0,1,2,3,4,5,6,7,8,9].map(i =>
							`<option value="${i}">${i}</option>`).join("")}
					</select>
					<button class="ev-perm-add-btn">${__("+ Add Role")}</button>
				</div>
			</div>

			<!-- ── Tab 2: Field Levels ───────────────────────────────────── -->
			<div class="ev-perm-pane" data-pane="fields">
				<div class="ev-perm-field-search-wrap">
					<svg class="ev-perm-search-icon" width="13" height="13" viewBox="0 0 16 16"
						fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
						<circle cx="6.5" cy="6.5" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>
					</svg>
					<input class="ev-perm-field-search" type="text"
						placeholder="${__("Search fields…")}">
				</div>
				<div class="ev-perm-field-list"></div>
			</div>

			<!-- ── Footer ───────────────────────────────────────────────── -->
			<div class="ev-perm-footer">
				<button class="ev-perm-reset-btn ev-perm-footer-btn ev-perm-footer-btn--danger"
					title="${__("Revert all permissions to app defaults")}">
					${__("Reset to Default")}
				</button>
				<span class="ev-perm-status"></span>
			</div>

		</div>`;
	}

	// ── Events ────────────────────────────────────────────────────────────────

	_bind_panel_events() {
		const $p = this.$panel;

		$p.on("click", ".ev-rs-close", () => this.toolbar._close_right_sidebar());

		$p.on("click", ".ev-perm-tab", (e) =>
			this._switch_tab($(e.currentTarget).data("tab")));

		// Role search
		$p.on("input", ".ev-perm-role-search", (e) => {
			const q = e.target.value;
			$p.find(".ev-perm-search-clear").toggle(!!q);
			this._filter_grid(q);
		});
		$p.on("click", ".ev-perm-search-clear", () => {
			$p.find(".ev-perm-role-search").val("");
			$p.find(".ev-perm-search-clear").hide();
			this._filter_grid("");
		});

		// Remove role (button inside HOT role cell — event bubbles out of HOT)
		$p.on("click", ".ev-prc-del", (e) => {
			e.stopPropagation();
			const $btn = $(e.currentTarget);
			this._remove_role($btn.data("role"), $btn.data("lvl"));
		});

		$p.on("click", ".ev-perm-add-btn",   () => this._add_role());
		$p.on("click", ".ev-perm-reset-btn", () => this._confirm_reset());
	}

	_switch_tab(tab) {
		this._active_tab = tab;
		this.$panel.find(".ev-perm-tab").removeClass("ev-perm-tab--active");
		this.$panel.find(`.ev-perm-tab[data-tab="${tab}"]`).addClass("ev-perm-tab--active");
		this.$panel.find(".ev-perm-pane").removeClass("ev-perm-pane--active");
		this.$panel.find(`.ev-perm-pane[data-pane="${tab}"]`).addClass("ev-perm-pane--active");

		if (tab === "fields" && !this._fields.length) {
			this._load_fields();
		} else if (tab === "roles" && this._hot) {
			requestAnimationFrame(() => this._hot?.render());
		}
	}

	// ── Data loading ──────────────────────────────────────────────────────────

	_load_data() {
		this._set_badge("loading");
		Promise.all([
			frappe.call({ method: "excel_view.api.get_doctype_permissions",
				args: { doctype: this.board.doctype }, freeze: false }),
			frappe.call({ method: "excel_view.api.get_all_roles", freeze: false }),
			frappe.call({ method: "excel_view.api.get_role_user_counts", freeze: false }),
		]).then(([perm_r, roles_r, counts_r]) => {
			this._data        = perm_r.message  || [];
			this._roles       = roles_r.message || [];
			this._role_counts = counts_r.message || {};
			this._render_role_tab();
			this._set_badge("live");
		}).catch(() => {
			this._set_badge("error");
			this.$panel?.find(".ev-perm-status").text(__("Failed to load"));
		});
	}

	_load_fields() {
		this._set_badge("loading");
		frappe.call({
			method: "excel_view.api.get_field_permlevels",
			args: { doctype: this.board.doctype },
			freeze: false,
		}).then(r => {
			this._fields = r.message || [];
			this._render_field_list(this._fields);
			this._set_badge("live");
		}).catch(() => this._set_badge("error"));
	}

	// ── Tab 1: Role Grid ──────────────────────────────────────────────────────

	_render_role_tab() {
		// Populate autocomplete — only show roles not already added
		const existing = new Set(this._data.map(r => r.role));
		const available = this._roles.filter(r => !existing.has(r));
		const $input = this.$panel.find(".ev-perm-role-sel");

		if (!this._role_awesomplete && $input.length) {
			this._role_awesomplete = new Awesomplete($input[0], {
				minChars: 0,
				maxItems: 30,
				autoFirst: true,
				// item is a plain string when list is string[]
				filter: (item, val) => !val || item.toLowerCase().includes(val.toLowerCase()),
				item: (text, val) => {
					const li = document.createElement("li");
					li.setAttribute("aria-selected", "false");
					li.textContent = text;
					if (val) {
						const idx = text.toLowerCase().indexOf(val.toLowerCase());
						if (idx !== -1) {
							li.innerHTML =
								frappe.utils.escape_html(text.slice(0, idx)) +
								`<mark>${frappe.utils.escape_html(text.slice(idx, idx + val.length))}</mark>` +
								frappe.utils.escape_html(text.slice(idx + val.length));
						}
					}
					return li;
				},
			});
			// Show all on focus when empty
			$input[0].addEventListener("focus", () => this._role_awesomplete.evaluate());
			// Enter on closed dropdown = confirm add
			$input[0].addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !this._role_awesomplete.opened) this._add_role();
			});
			// Escape overflow:hidden parents by fixing the ul position on open
			$input[0].addEventListener("awesomplete-open", () => {
				const ul = this._role_awesomplete.ul;
				const rect = $input[0].getBoundingClientRect();
				const ulH = Math.min(ul.scrollHeight || 200, 200);
				const spaceBelow = window.innerHeight - rect.bottom - 6;
				ul.style.position = "fixed";
				ul.style.left     = rect.left + "px";
				ul.style.width    = rect.width + "px";
				ul.style.zIndex   = "99999";
				if (spaceBelow >= ulH) {
					ul.style.top    = (rect.bottom + 4) + "px";
					ul.style.bottom = "auto";
				} else {
					ul.style.bottom = (window.innerHeight - rect.top + 4) + "px";
					ul.style.top    = "auto";
				}
			});
		}

		if (this._role_awesomplete) {
			this._role_awesomplete.list = available;
		}

		// Build HOT data
		this._grid_data = this._data.map(row => {
			const d = { role: row.role, permlevel: row.permlevel || 0 };
			PERM_FLAGS.forEach(f => { d[f] = row[f] ? 1 : 0; });
			return d;
		});

		this._destroy_hot();
		this._init_hot(this._grid_data);
	}

	_init_hot(grid_data) {
		const $wrap = this.$panel.find(".ev-perm-hot-wrap");
		if (!$wrap.length || !window.Handsontable) return;

		const panel = this;
		const panel_h = this.$panel[0]?.offsetHeight || 520;
		// subtract: header(72) + tabs(38) + search(42) + add-row(46) + footer(44) + buffer
		const hot_h = Math.max(140, panel_h - 260);

		this._hot = new window.Handsontable($wrap[0], {
			data: grid_data,
			columns: PERM_COLS,
			colHeaders: true,
			rowHeaders: false,
			height: hot_h,
			width: "100%",
			licenseKey: "non-commercial-and-evaluation",
			stretchH: "last",
			autoWrapRow: false,
			autoWrapCol: false,
			outsideClickDeselects: false,
			manualColumnResize: false,
			wordWrap: false,
			renderAllRows: false,

			// ── Green flash class on saved cells ─────────────────────────
			cells(row, col) {
				const flash = panel._flashing.has(`${row}:${col}`) ? "ev-perm-cell-saved" : "";
				return flash ? { className: flash } : {};
			},

			// ── Color-coded column headers + tooltips ─────────────────────
			afterGetColHeader(col, TH) {
				const key = PERM_COLS[col]?.data;
				if (!key) return;
				TH.classList.remove("ev-phdr-read", "ev-phdr-danger", "ev-phdr-advanced");
				if      (_READ_FLAGS.has(key))   TH.classList.add("ev-phdr-read");
				else if (_DANGER_FLAGS.has(key)) TH.classList.add("ev-phdr-danger");
				else if (key !== "role" && key !== "permlevel") TH.classList.add("ev-phdr-advanced");
				if (_FLAG_TIPS[key]) TH.title = _FLAG_TIPS[key];
			},

			// ── Role cell: name + user count (clean single-line) ─────────
			afterRenderer(TD, row, col, prop, value) {
				if (col !== COL_IDX.role) return;
				const count = panel._role_counts[value];
				const row_data = panel._hot?.getSourceDataAtRow(row);
				const lvl = row_data?.permlevel ?? 0;
				const meta = count !== undefined ? `· ${count}` : "";
				TD.innerHTML = `
					<div class="ev-prc-wrap">
						<span class="ev-prc-name">${frappe.utils.escape_html(value || "")}</span>
						<span class="ev-prc-meta">${meta}</span>
						<button class="ev-prc-del"
							data-role="${frappe.utils.escape_html(value || "")}"
							data-lvl="${lvl}"
							title="${__("Remove")}">×</button>
					</div>`;
			},

			// ── Save on change ────────────────────────────────────────────
			afterChange(changes, source) {
				if (source === "loadData" || !changes) return;
				changes.forEach(([row, prop, old_val, new_val]) => {
					if (old_val === new_val) return;
					panel._on_cell_change(row, prop, old_val, new_val);
				});
			},
		});
	}

	// ── Role search / filter ──────────────────────────────────────────────────

	_filter_grid(query) {
		if (!this._hot || !this._grid_data) return;
		const q = (query || "").toLowerCase().trim();
		const filtered = q
			? this._grid_data.filter(r => r.role.toLowerCase().includes(q))
			: this._grid_data;

		const has_results = filtered.length > 0;
		this.$panel.find(".ev-perm-hot-wrap").toggle(has_results);
		this.$panel.find(".ev-perm-empty-state").toggle(!has_results);

		if (has_results) {
			this._hot.loadData(filtered);
		}
	}

	// ── Cell save + flash feedback ────────────────────────────────────────────

	_on_cell_change(row, prop, old_val, new_val) {
		const row_data = this._hot?.getSourceDataAtRow(row);
		if (!row_data) return;
		const { role, permlevel } = row_data;
		const key = `${role}:${permlevel}:${prop}`;

		clearTimeout(this._timers[key]);
		this._pending++;
		this._set_badge("saving");

		this._timers[key] = setTimeout(() => {
			frappe.call({
				method: "excel_view.api.update_role_permission",
				args: {
					doctype:   this.board.doctype,
					role,
					permlevel,
					ptype:     prop,
					value:     new_val ? "1" : "0",
				},
				freeze: false,
				callback: () => {
					this._pending = Math.max(0, this._pending - 1);
					if (!this._pending) this._set_badge("live");
					// Green flash
					const col = COL_IDX[prop];
					if (col !== undefined) this._flash(row, col);
				},
				error: () => {
					// Rollback optimistic update
					const col = COL_IDX[prop];
					if (col !== undefined) this._hot?.setDataAtCell(row, col, old_val, "rollback");
					this._pending = Math.max(0, this._pending - 1);
					if (!this._pending) this._set_badge("error");
					frappe.show_alert({
						message: __("Permission change could not be saved."),
						indicator: "red",
					});
				},
			});
		}, 400);
	}

	_flash(row, col) {
		if (!this._hot) return;
		const k = `${row}:${col}`;
		this._flashing.add(k);
		this._hot.render();
		setTimeout(() => {
			this._flashing.delete(k);
			this._hot?.render();
		}, 650);
	}

	// ── Role CRUD ─────────────────────────────────────────────────────────────

	_add_role() {
		const role      = (this.$panel.find(".ev-perm-role-sel").val() || "").trim();
		const permlevel = parseInt(this.$panel.find(".ev-perm-lvl-sel").val(), 10) || 0;
		if (!role) {
			frappe.show_alert({ message: __("Select a role first."), indicator: "orange" });
			return;
		}
		if (!this._roles.includes(role)) {
			frappe.show_alert({ message: __('"{0}" is not a valid role.', [role]), indicator: "red" });
			return;
		}
		// Clear input immediately for next entry
		this.$panel.find(".ev-perm-role-sel").val("");
		this._set_badge("saving");
		frappe.call({
			method:   "excel_view.api.add_role_permission",
			args:     { doctype: this.board.doctype, role, permlevel },
			freeze:   false,
			callback: () => { this._set_badge("live"); this._reload(); },
			error:    () => this._set_badge("error"),
		});
	}

	_remove_role(role, permlevel) {
		frappe.confirm(
			__("Remove permission row for <b>{0}</b> (level {1})?",
				[frappe.utils.escape_html(role), permlevel]),
			() => {
				this._set_badge("saving");
				frappe.call({
					method:   "excel_view.api.remove_role_permission",
					args:     { doctype: this.board.doctype, role, permlevel },
					freeze:   false,
					callback: () => { this._set_badge("live"); this._reload(); },
					error:    () => this._set_badge("error"),
				});
			}
		);
	}

	_confirm_reset() {
		frappe.confirm(
			__("Reset all permissions for <b>{0}</b> to app defaults? This cannot be undone.",
				[frappe.utils.escape_html(this.board.doctype)]),
			() => {
				this._set_badge("saving");
				frappe.call({
					method:   "excel_view.api.reset_doctype_permissions",
					args:     { doctype: this.board.doctype },
					freeze:   false,
					callback: () => { this._set_badge("live"); this._reload(); },
					error:    () => this._set_badge("error"),
				});
			}
		);
	}

	_reload() {
		this._destroy_hot();
		this._fields = [];
		this.$panel?.find(".ev-perm-role-search").val("");
		this.$panel?.find(".ev-perm-search-clear").hide();
		this._load_data();
	}

	_destroy_hot() {
		if (this._hot) { this._hot.destroy(); this._hot = null; }
		this._flashing.clear();
	}

	// ── Tab 2: Field Level List ───────────────────────────────────────────────

	_render_field_list(fields) {
		const $list = this.$panel.find(".ev-perm-field-list").empty();

		fields.forEach(f => {
			const $row = $(`
				<div class="ev-perm-field-row" data-fieldname="${frappe.utils.escape_html(f.fieldname)}">
					<span class="ev-pfl-label" title="${frappe.utils.escape_html(f.fieldname)}">
						${frappe.utils.escape_html(f.label)}
					</span>
					<span class="ev-pfl-type">${frappe.utils.escape_html(f.fieldtype)}</span>
					<select class="ev-pfl-lvl" title="${__("Permission Level")}">
						${[0,1,2,3,4,5,6,7,8,9].map(i =>
							`<option value="${i}"${i === f.permlevel ? " selected" : ""}>${i}</option>`
						).join("")}
					</select>
				</div>`);

			$row.find(".ev-pfl-lvl").on("change", (e) =>
				this._save_field_permlevel(f.fieldname, parseInt(e.target.value, 10), $(e.target)));

			$list.append($row);
		});

		// Live search
		this.$panel.find(".ev-perm-field-search").off("input.evperm").on("input.evperm", (e) => {
			const q = e.target.value.toLowerCase().trim();
			$list.find(".ev-perm-field-row").each((_, el) => {
				const fn  = (el.dataset.fieldname || "").toLowerCase();
				const lbl = $(el).find(".ev-pfl-label").text().toLowerCase();
				$(el).toggle(!q || fn.includes(q) || lbl.includes(q));
			});
		});
	}

	_save_field_permlevel(fieldname, permlevel, $sel) {
		const key = `field:${fieldname}`;
		clearTimeout(this._timers[key]);
		this._pending++;
		this._set_badge("saving");

		this._timers[key] = setTimeout(() => {
			const prev = parseInt($sel.data("prev") ?? $sel.val(), 10);
			$sel.data("prev", permlevel);

			frappe.call({
				method: "excel_view.api.set_field_permlevel",
				args:   { doctype: this.board.doctype, fieldname, permlevel },
				freeze: false,
				callback: () => {
					this._pending = Math.max(0, this._pending - 1);
					if (!this._pending) this._set_badge("live");
					// Brief green border on the select
					$sel.addClass("ev-pfl-saved");
					setTimeout(() => $sel.removeClass("ev-pfl-saved"), 700);
				},
				error: () => {
					$sel.val(prev);
					this._pending = Math.max(0, this._pending - 1);
					if (!this._pending) this._set_badge("error");
					frappe.show_alert({
						message: __("Field permlevel could not be saved."),
						indicator: "red",
					});
				},
			});
		}, 400);
	}

	// ── Status badge ──────────────────────────────────────────────────────────

	_set_badge(state) {
		const $b = this.$panel?.find(".ev-perm-badge");
		if (!$b?.length) return;
		$b.attr("data-state", state);
		const labels = {
			live:    __("Live"),
			saving:  __("Saving…"),
			error:   __("Error"),
			loading: __("Loading"),
		};
		$b.find(".ev-perm-badge-label").text(labels[state] || state);
		// Mirror in footer status for accessible text
		this.$panel?.find(".ev-perm-status").text(
			state === "live" ? __("All changes saved") : (labels[state] || "")
		);
	}
};
