/**
 * excel_view/components/sheet_manager.js  — V2.5
 *
 * Manages multiple sheet tabs within one ExcelBoard session.
 * Each tab is an independent DocType view with its own columns, data,
 * filters, formula columns, and HyperFormula sheet registration.
 *
 * Architecture:
 *  - SheetManager owns the tab strip DOM (appended below ev-grid-wrapper).
 *  - ExcelBoard delegates data-loading and column-building per sheet.
 *  - Switching tabs saves HOT scroll/widths → swaps columns + data → restores.
 *  - Sheet 0 (base doctype) cannot be removed or have its doctype changed.
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.SheetManager = class SheetManager {
	/**
	 * @param {Object} opts
	 * @param {Object} opts.board      - ExcelBoard instance
	 * @param {string} opts.doctype    - Base DocType (Sheet 0)
	 */
	constructor(opts) {
		this.board = opts.board;
		this._sheets = new Map(); // id → SheetState
		this._active_id = null;
		this._uid = 0;
		this.$tabs = null; // tab strip jQuery element
		this.$ilk_banner = null; // IntelliLookup banner element
	}

	// ── Public API ────────────────────────────────────────────────────────

	setup() {
		// Create Sheet 0 for the base doctype
		const s0 = this._make_state({
			label: this.board.doctype,
			doctype: this.board.doctype,
		});
		s0.hf_sheet_id = this.board.formula_bridge.sheet_id; // already Sheet1
		this._sheets.set(s0.id, s0);
		this._active_id = s0.id;

		this._build_tab_strip();
		this._render_tabs();
	}

	/** Add a new sheet tab via dialog. */
	prompt_add_sheet() {
		const d = new frappe.ui.Dialog({
			title: __("Add Sheet"),
			fields: [
				{
					label: __("DocType"),
					fieldname: "doctype",
					fieldtype: "Link",
					options: "DocType",
					reqd: 1,
					get_query: () => ({
						filters: { istable: 0, issingle: 0 },
					}),
				},
				{
					label: __("Tab Label (optional)"),
					fieldname: "label",
					fieldtype: "Data",
				},
			],
			primary_action_label: __("Add"),
			primary_action: (vals) => {
				if (!vals.doctype) return;
				frappe.has_permission(vals.doctype, "read", () => {
					d.hide();
					this.add_sheet(vals.doctype, vals.label || vals.doctype);
				});
			},
		});
		d.show();
	}

	/**
	 * Add a new sheet tab programmatically.
	 * @param {string} doctype
	 * @param {string} label
	 * @returns {string} new sheet id
	 */
	add_sheet(doctype, label) {
		const s = this._make_state({ doctype, label });
		// Register HF sheet
		s.hf_sheet_id = this.board.formula_bridge.add_hf_sheet(label);
		this._sheets.set(s.id, s);
		this._render_tabs();
		this.switch_to(s.id);

		// Trigger IntelliLookup detection
		const base = this._sheets.get(this._get_sheet0_id());
		if (base && base.doctype !== doctype) {
			this._trigger_intellilookup(base.doctype, doctype, s.id);
		}
		return s.id;
	}

	/**
	 * Switch to a sheet tab by id.
	 * @param {string} id
	 */
	switch_to(id) {
		if (id === this._active_id) return;

		// Save HOT scroll + col widths for current sheet
		this._save_hot_state(this._active_id);

		const next = this._sheets.get(id);
		if (!next) return;

		this._active_id = id;
		this._render_tabs();
		this._hide_ilk_banner();

		if (next.data && next.data.length) {
			// Data already fetched — swap directly
			this._apply_sheet(next);
		} else {
			// Lazy fetch — show loading state, fetch data for next doctype
			this._lazy_fetch(next);
		}
	}

	/** Remove a non-base sheet tab. */
	remove_sheet(id) {
		if (id === this._get_sheet0_id()) return; // cannot remove base sheet
		const s = this._sheets.get(id);
		if (!s) return;
		frappe.confirm(
			__("Remove sheet <b>{0}</b>?", [s.label]),
			() => {
				this._sheets.delete(id);
				if (this._active_id === id) {
					this.switch_to(this._get_sheet0_id());
				}
				this._render_tabs();
			}
		);
	}

	/** Get the active SheetState. */
	get_current() {
		return this._sheets.get(this._active_id);
	}

	/** Get all SheetStates as array. */
	get_all() {
		return [...this._sheets.values()];
	}

	/** Return the base (Sheet 0) id. */
	_get_sheet0_id() {
		return this._sheets.keys().next().value;
	}

	/**
	 * Serialize all sheets for workbook persistence.
	 * Omits runtime-only fields (data, hot_scroll).
	 * @returns {Array}
	 */
	serialize() {
		return [...this._sheets.values()].map((s) => ({
			id: s.id,
			label: s.label,
			doctype: s.doctype,
			hf_sheet_id: s.hf_sheet_id,
			col_widths: s.col_widths,
			frozen: s.frozen,
			columns_config: s.columns_config,
			formula_columns: s.formula_columns,
			filters: s.filters,
			sort_by: s.sort_by,
			lookup_cols: s.lookup_cols,
		}));
	}

	/**
	 * Restore sheets from workbook config.
	 * Sheet 0 already exists; additional sheets are created and lazy-fetched.
	 * @param {Array} sheets_config
	 */
	restore(sheets_config) {
		if (!sheets_config || !sheets_config.length) return;

		// Skip first entry (Sheet 0 = base doctype, already set up)
		sheets_config.slice(1).forEach((cfg) => {
			const s = this._make_state({
				doctype: cfg.doctype,
				label: cfg.label,
				id: cfg.id, // restore original id for cross-sheet refs
			});
			Object.assign(s, {
				hf_sheet_id: this.board.formula_bridge.add_hf_sheet(cfg.label),
				col_widths: cfg.col_widths || {},
				frozen: cfg.frozen || 0,
				columns_config: cfg.columns_config || null,
				formula_columns: cfg.formula_columns || [],
				filters: cfg.filters || [],
				sort_by: cfg.sort_by || null,
				lookup_cols: cfg.lookup_cols || [],
			});
			this._sheets.set(s.id, s);
		});

		// Restore Sheet 0 config from first entry if provided
		const s0_cfg = sheets_config[0];
		if (s0_cfg) {
			const s0 = this._sheets.get(this._get_sheet0_id());
			if (s0) {
				s0.lookup_cols = s0_cfg.lookup_cols || [];
			}
		}

		this._render_tabs();
	}

	/**
	 * Store data for the active sheet (called by board.refresh).
	 * @param {Array} data
	 */
	set_current_data(data) {
		const s = this.get_current();
		if (s) s.data = data;
	}

	/** Save current column config into active sheet state (for workbook save). */
	save_current_columns(columns_config, formula_columns, filters, sort_by) {
		const s = this.get_current();
		if (!s) return;
		s.columns_config = columns_config;
		s.formula_columns = formula_columns;
		s.filters = filters;
		s.sort_by = sort_by;
	}

	destroy() {
		if (this.$tabs) this.$tabs.remove();
		this._hide_ilk_banner();
	}

	// ── IntelliLookup ─────────────────────────────────────────────────────

	_trigger_intellilookup(src_doctype, tgt_doctype, tgt_sheet_id) {
		frappe.call({
			method: "excel_view.api.detect_lookup",
			args: { src_doctype, tgt_doctype },
			callback: (r) => {
				const candidates = r.message || [];
				if (!candidates.length) return;
				const best = candidates[0];
				if (best.confidence >= 0.4) {
					this._show_ilk_banner(src_doctype, tgt_doctype, best, tgt_sheet_id);
				}
			},
		});
	}

	_show_ilk_banner(src_doctype, tgt_doctype, candidate, tgt_sheet_id) {
		this._hide_ilk_banner();

		const $banner = $(`
			<div class="ev-intellilookup-banner">
				<span class="ev-ilk-icon">💡</span>
				<span class="ev-ilk-msg">
					<b>${frappe.utils.escape_html(candidate.label || candidate.src_field)}</b>
					${__("in")} <b>${frappe.utils.escape_html(src_doctype)}</b>
					${__("links to")} <b>${frappe.utils.escape_html(tgt_doctype)}</b>.
				</span>
				<a class="ev-ilk-apply">${__("Add lookup columns →")}</a>
				<a class="ev-ilk-dismiss">✕</a>
			</div>
		`);

		$banner.find(".ev-ilk-apply").on("click", () => {
			this._open_lookup_picker(src_doctype, tgt_doctype, candidate, tgt_sheet_id);
		});
		$banner.find(".ev-ilk-dismiss").on("click", () => this._hide_ilk_banner());

		// Insert below toolbar, above grid
		this.$ilk_banner = $banner;
		this.board.$wrapper.find(".ev-grid-wrapper").prepend($banner);
	}

	_hide_ilk_banner() {
		if (this.$ilk_banner) {
			this.$ilk_banner.remove();
			this.$ilk_banner = null;
		}
	}

	_open_lookup_picker(src_doctype, tgt_doctype, candidate, tgt_sheet_id) {
		// Load tgt doctype meta to show field checkboxes
		frappe.model.with_doctype(tgt_doctype, () => {
			const meta = frappe.get_meta(tgt_doctype);
			const pickable = meta.fields.filter(
				(f) =>
					!["Section Break", "Column Break", "HTML", "Table"].includes(f.fieldtype) &&
					f.fieldname !== "name"
			);

			const fields_html = pickable
				.map(
					(f) => `<label class="ev-ilk-field-row">
					<input type="checkbox" data-fieldname="${f.fieldname}" data-label="${frappe.utils.escape_html(f.label)}">
					<span>${frappe.utils.escape_html(f.label || f.fieldname)}</span>
				</label>`
				)
				.join("");

			const d = new frappe.ui.Dialog({
				title: __("Lookup from {0}", [tgt_doctype]),
				fields: [
					{
						fieldtype: "HTML",
						options: `
							<p style="font-size:12px;color:var(--text-muted)">
								${__("Join key:")} <b>${candidate.label || candidate.src_field}</b>
								→ <b>${candidate.tgt_field}</b>
							</p>
							<p style="font-size:12px;margin-bottom:6px">${__("Select fields to pull:")}</p>
							<div class="ev-ilk-field-list" style="max-height:260px;overflow-y:auto">
								${fields_html}
							</div>
						`,
					},
				],
				primary_action_label: __("Add Lookup Columns"),
				primary_action: () => {
					const checked = [...d.$wrapper.find(".ev-ilk-field-list input:checked")];
					if (!checked.length) {
						frappe.show_alert({ message: __("Select at least one field"), indicator: "orange" }, 3);
						return;
					}
					const return_fields = checked.map((el) => ({
						fieldname: el.dataset.fieldname,
						label: el.dataset.label,
					}));
					d.hide();
					this._apply_lookup(src_doctype, tgt_doctype, candidate, return_fields, tgt_sheet_id);
				},
			});
			d.show();

			// Style field list
			d.$wrapper.find(".ev-ilk-field-list").css({ display: "flex", flexDirection: "column", gap: "4px" });
			d.$wrapper.find(".ev-ilk-field-row").css({ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" });
		});
	}

	_apply_lookup(src_doctype, tgt_doctype, candidate, return_fields, tgt_sheet_id) {
		const base_data = this.board.list_view.data;
		const tgt_sheet = this._sheets.get(tgt_sheet_id);
		const tgt_data = tgt_sheet?.data || [];

		if (!tgt_data.length) {
			frappe.show_alert({ message: __("Target sheet has no data yet. Click its tab first."), indicator: "orange" }, 4);
			return;
		}

		// Build index: tgt_field value → tgt row
		const tgt_index = new Map();
		tgt_data.forEach((r) => {
			const key = r[candidate.tgt_field];
			if (key != null) tgt_index.set(String(key), r);
		});

		// Inject values into base_data
		base_data.forEach((row) => {
			const key = String(row[candidate.src_field] || "");
			const match = tgt_index.get(key);
			return_fields.forEach(({ fieldname }) => {
				const col_key = `${tgt_doctype}__lookup__${fieldname}`;
				row[col_key] = match ? (match[fieldname] ?? "") : "";
			});
		});

		// Build virtual lookup columns
		const lookup_cols = return_fields.map(({ fieldname, label }) => ({
			data: `${tgt_doctype}__lookup__${fieldname}`,
			title: `${tgt_doctype}: ${label}`,
			type: "text",
			width: 160,
			readOnly: true,
			_readonly: true,
			_is_lookup_col: true,
		}));

		// Track on base sheet state for workbook save
		const s0 = this._sheets.get(this._get_sheet0_id());
		if (s0) s0.lookup_cols = (s0.lookup_cols || []).concat(return_fields.map((f) => ({
			doctype: tgt_doctype,
			...f,
			src_field: candidate.src_field,
			tgt_field: candidate.tgt_field,
		})));

		this._hide_ilk_banner();
		this.board._inject_lookup_columns(lookup_cols, base_data);
		frappe.show_alert({ message: __("Lookup columns added from {0}", [tgt_doctype]), indicator: "green" }, 3);
	}

	// ── Tab Strip DOM ─────────────────────────────────────────────────────

	_build_tab_strip() {
		this.$tabs = $(`<div class="ev-sheet-tabs"></div>`);
		// Append below ev-hot-container (inside ev-grid-wrapper, after status bar)
		const $wrapper = this.board.$wrapper.find(".ev-grid-wrapper");
		$wrapper.append(this.$tabs);
	}

	_render_tabs() {
		if (!this.$tabs) return;

		const html = [...this._sheets.values()]
			.map((s) => {
				const is_active = s.id === this._active_id;
				const is_base = s.id === this._get_sheet0_id();
				return `
				<div class="ev-sheet-tab${is_active ? " ev-sheet-tab--active" : ""}"
					data-id="${s.id}" title="${frappe.utils.escape_html(s.doctype)}">
					<span class="ev-tab-label">${frappe.utils.escape_html(s.label)}</span>
					${!is_base ? `<button class="ev-tab-close" data-id="${s.id}" title="${__("Remove")}">×</button>` : ""}
				</div>`;
			})
			.join("");

		this.$tabs.html(
			html + `<button class="ev-sheet-add" title="${__("Add Sheet")}">+</button>`
		);

		// Events
		this.$tabs.find(".ev-sheet-tab").on("click", (e) => {
			if ($(e.target).hasClass("ev-tab-close")) return;
			const id = $(e.currentTarget).data("id");
			if (id && id !== this._active_id) this.switch_to(id);
		});
		this.$tabs.find(".ev-tab-close").on("click", (e) => {
			e.stopPropagation();
			this.remove_sheet($(e.currentTarget).data("id"));
		});
		this.$tabs.find(".ev-sheet-add").on("click", () => this.prompt_add_sheet());

		// Double-click label → inline rename
		this.$tabs.find(".ev-tab-label").on("dblclick", (e) => {
			e.stopPropagation();
			const $tab = $(e.currentTarget).closest(".ev-sheet-tab");
			const id = $tab.data("id");
			const s = this._sheets.get(id);
			if (!s) return;
			const $lbl = $(e.currentTarget);
			const old = s.label;
			const $inp = $(`<input class="ev-tab-rename" value="${frappe.utils.escape_html(old)}">`);
			$lbl.replaceWith($inp);
			$inp.focus().select();
			const commit = () => {
				const val = $inp.val().trim() || old;
				s.label = val;
				this._render_tabs();
			};
			$inp.on("blur", commit).on("keydown", (ev) => {
				if (ev.key === "Enter") $inp.blur();
				if (ev.key === "Escape") { s.label = old; this._render_tabs(); }
			});
		});
	}

	// ── HOT swap helpers ──────────────────────────────────────────────────

	_save_hot_state(id) {
		if (!id) return;
		const s = this._sheets.get(id);
		if (!s || !this.board.hot) return;
		const holder = this.board.hot.rootElement?.querySelector(".wtHolder");
		if (holder) s.hot_scroll = { left: holder.scrollLeft, top: holder.scrollTop };
	}

	_apply_sheet(sheet) {
		const board = this.board;

		// Rebuild columns for this sheet's doctype
		board._switch_sheet_context(sheet);

		// Swap HF active sheet
		board.formula_bridge.set_active_sheet(sheet.hf_sheet_id);
		const mat = board.data_manager.to_matrix(sheet.data, board.columns);
		board.formula_bridge.reload_for_sheet(sheet.hf_sheet_id, mat);
		board.matrix = mat;

		// Load into HOT
		board.hot.updateSettings({
			columns: board.columns,
			fixedColumnsLeft: sheet.frozen || 0,
		});
		board.hot.loadData(sheet.data);

		// Restore scroll
		setTimeout(() => {
			const holder = board.hot.rootElement?.querySelector(".wtHolder");
			if (holder && sheet.hot_scroll) {
				holder.scrollLeft = sheet.hot_scroll.left;
				holder.scrollTop = sheet.hot_scroll.top;
			}
		}, 0);

		board.toolbar?.sync?.();
		board.status_bar?.clear?.();
	}

	_lazy_fetch(sheet) {
		const board = this.board;
		// Temporarily rebuild columns so the grid shows the right headers
		board._switch_sheet_context(sheet);
		board.hot.updateSettings({ columns: board.columns });
		board.hot.loadData([]);

		// Use frappe.get_list to fetch data for the sheet's doctype
		const fields = sheet.columns_config
			? sheet.columns_config.filter((c) => !c.is_formula_col).map((c) => c.fieldname || c.key).filter(Boolean)
			: ["name"];

		if (!fields.includes("name")) fields.unshift("name");

		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: sheet.doctype,
				fields,
				filters: sheet.filters || [],
				order_by: sheet.sort_by ? `${sheet.sort_by.field} ${sheet.sort_by.order}` : "modified desc",
				limit: 100,
			},
			callback: (r) => {
				const data = r.message || [];
				sheet.data = data;
				this._apply_sheet(sheet);
			},
		});
	}

	// ── State helpers ─────────────────────────────────────────────────────

	_make_state({ doctype, label, id }) {
		return {
			id: id || `ev_sheet_${++this._uid}_${Date.now()}`,
			label: label || doctype,
			doctype,
			hf_sheet_id: 0,
			data: null,
			hot_scroll: { left: 0, top: 0 },
			col_widths: {},
			frozen: 0,
			columns_config: null,
			formula_columns: [],
			filters: [],
			sort_by: null,
			lookup_cols: [],
		};
	}
};
