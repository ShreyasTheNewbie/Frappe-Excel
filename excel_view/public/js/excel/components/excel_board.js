/**
 * excel_view/components/excel_board.js
 *
 * Main controller for the Excel View grid.
 * Owns the Handsontable instance and coordinates all sub-components:
 *   Toolbar, FormulaBar, ColumnManager, DataManager, FormulaBridge, ContextMenu.
 *
 * Lifecycle:
 *   new ExcelBoard(opts) → _setup() → HOT initialised → ready
 *   board.refresh(data)  → HOT reloaded with new data
 */

import Handsontable from "handsontable";

frappe.provide("frappe.views");
frappe.provide("frappe.views.excel");

frappe.views.ExcelBoard = class ExcelBoard {
	/**
	 * @param {Object}  opts
	 * @param {Element} opts.wrapper       - DOM container for the HOT grid
	 * @param {Element} opts.formula_bar   - DOM container for the formula bar
	 * @param {Element} [opts.toolbar]     - DOM container for the toolbar (optional)
	 * @param {string}  opts.doctype
	 * @param {Object}  opts.meta          - Frappe DocType meta
	 * @param {Object[]} opts.data         - Array of row objects from server
	 * @param {Array[]} opts.fields        - [[fieldname, doctype], ...]
	 * @param {Object}  opts.list_view     - ExcelView (ListView) instance
	 */
	constructor(opts) {
		Object.assign(this, opts);
		this.hot = null;
		this.matrix = [];
		this.columns = [];
		// Sparse map of per-cell formatting: { "row:col": { bold, italic, ... } }
		this.format_store = {};
		// Snapshot of list_view.fields at board creation time so _deselect() can
		// restore it after a workbook (which overwrites list_view.fields) is closed.
		this._default_list_view_fields = [...(this.list_view.fields || [])];
		this._setup();
	}

	// ── Setup ─────────────────────────────────────────────────────────────────

	_setup() {
		// 1. Sub-components
		this.column_manager = new frappe.views.excel.ColumnManager({
			board: this,
			meta: this.meta,
			fields: this.fields,
			can_write: this.list_view.can_write,
		});

		this.data_manager = new frappe.views.excel.DataManager({ board: this });

		this.formula_bridge = new frappe.views.excel.FormulaBridge({ board: this });

		this.context_menu = new frappe.views.excel.ContextMenu({ board: this });

		this.formula_bar_component = new frappe.views.excel.FormulaBar({
			board: this,
			wrapper: this.formula_bar,
		});

		this.export_manager = new frappe.views.excel.ExportManager({ board: this });

		// Toolbar (optional — only if wrapper provided)
		if (this.toolbar) {
			this.toolbar_component = new frappe.views.excel.ExcelToolbar({
				board: this,
				wrapper: this.toolbar,
			});
		}

		// Workbook manager — handles Save / Load view persistence.
		// Must be created before setup() so it can bind to toolbar buttons
		// that toolbar_component.setup() renders.
		this.workbook_manager = new frappe.views.excel.WorkbookManager({ board: this });

		// 2. Load persisted freeze state (needed before _init_hot)
		this._frozen_cols = this.column_manager.load_freeze();

		// Build columns + matrix
		this.columns = this.column_manager.get_columns();
		// _master_columns is the authoritative list of ALL columns (visible + hidden).
		// this.columns = visible subset. Slicing keeps them independent.
		this._master_columns = [...this.columns];
		this._hidden_col_keys = new Set(); // data keys of hidden columns
		this.matrix = this.data_manager.to_matrix(this.data, this.columns);

		// Initialise formula engine
		this.formula_bridge.init(this.matrix);

		// V2.3 — Wire the async formula manager to the live HF instance.
		// Must happen after formula_bridge.init() which calls HyperFormula.buildEmpty().
		frappe.views.excel.formula_manager?.set_hf(this.formula_bridge.hf);

		// 4. Render formula bar + toolbar, then set up workbook manager bindings
		this.formula_bar_component.setup();
		this.toolbar_component?.setup();
		this.workbook_manager.setup(); // binds to toolbar buttons rendered above

		// 5. Build HOT container and initialise
		this._init_container();
		// Restore frozen-column class from user_settings (before HOT init)
		if (this._frozen_cols > 0) this.$hot_container.addClass("ev-cols-frozen");
		this._init_hot();

		// V2.3 — Wire the re-render callback now that this.hot exists.
		frappe.views.excel.formula_manager?.set_rerender(() => this.hot?.render());

		// Status bar — after container is ready so $status_bar_container exists
		this.status_bar = new frappe.views.excel.StatusBar({
			board: this,
			wrapper: this.$status_bar_container[0],
		});

		// 6. Keyboard shortcuts
		this._bind_shortcuts();
	}

	_init_container() {
		this.$wrapper = $(this.wrapper);
		this.$wrapper.empty().addClass("ev-grid-wrapper");

		this.$hot_container = $('<div class="ev-hot-container">').appendTo(this.$wrapper);

		// Status bar — fixed footer below the grid
		this.$status_bar_container = $('<div class="ev-status-bar-container">').appendTo(this.$wrapper);

		// ResizeObserver — fires whenever the wrapper changes size (sidebar toggle,
		// window resize, panel open/close). Debounced so rapid events don't pile up.
		// Must also update HOT's height setting so scrollbars recalculate correctly.
		this._resize_observer = new ResizeObserver(
			frappe.utils.debounce(() => {
				if (!this.hot) return;
				const h = this.$hot_container[0].clientHeight;
				if (h > 0) this.hot.updateSettings({ height: h });
				this.hot.render();
			}, 60)
		);
		this._resize_observer.observe(this.$wrapper[0]);
	}

	_init_hot() {
		this.hot = new Handsontable(this.$hot_container[0], {
			// Data — array-of-objects mode
			data: this.data,
			columns: this.columns,

			// Headers — function so we can show col letter + field name
			colHeaders: (col) => this._col_header_html(col),
			rowHeaders: true,

			// Behaviour
			manualColumnResize: true,
			manualRowResize: true,
			columnSorting: true,
			allowInsertRow: this.list_view.can_create,
			allowRemoveRow: this.list_view.can_write,
			copyPaste: true,
			undo: true,
			search: true,
			comments: true,
			observeChanges: false,
			// Keep selection alive when clicking toolbar buttons outside the grid.
			// Default (true) clears selection on outside click → toolbar becomes a no-op.
			outsideClickDeselects: false,

			// Column sort via dropdown — full autoFilter disabled; Frappe's sidebar
		// handles filtering so we expose only sort_asc / sort_desc in the header menu.
			filters: false,
			dropdownMenu: ["sort_asc", "sort_desc"],

			// Context menu (right-click)
			contextMenu: this.context_menu.get_config(),

			// Frozen columns — restored from user_settings
			fixedColumnsLeft: this._frozen_cols,

			// Layout — flex child, so height: "100%" fills the ev-hot-container flex slot
			height: "100%",
			// "last" stretches only the final column to fill remaining space;
			// all other columns keep their configured widths and a horizontal
			// scrollbar appears when total width exceeds the container.
			// "all" compresses columns proportionally — breaks with 20+ fields.
			stretchH: "last",
			wordWrap: false,
			autoWrapRow: false,
			autoWrapCol: false,

			// Cell-level meta (readOnly, className)
			cells: (row, col) => this.data_manager.get_cell_meta(row, col),

			// Hooks
			afterChange: (changes, source) => this._on_change(changes, source),
			afterSelection: (r, c, r2, c2) => this._on_selection(r, c, r2, c2),
			afterColumnResize: (col, size) => this._on_col_resize(col, size),
			afterRender: () => this._on_render(),
			afterRenderer: (TD, row, col, prop, value) => this._apply_cell_format(TD, row, col, value),

			// i18n
			language: frappe.boot.lang === "ar" || frappe.boot.lang === "he" ? "ar-AR" : undefined,
		});

		// HOT height:"100%" reads clientHeight at init time — in a flex layout that
		// value may be 0 before the browser has painted. Force a correct pixel height
		// after the next paint so HOT's scroll containers initialise properly.
		setTimeout(() => {
			if (!this.hot) return;
			const h = this.$hot_container[0].clientHeight;
			if (h > 0) this.hot.updateSettings({ height: h });
			this.hot.render();
		}, 0);
	}

	// ── Column header HTML ─────────────────────────────────────────────────────

	/**
	 * Returns HTML for a column header showing:
	 *  - Small Excel column letter (A, B, C...) at top
	 *  - Field label below (bold)
	 */
	_col_header_html(col) {
		const letter = this._col_idx_to_letter(col);
		const name = frappe.utils.escape_html(this.columns[col]?.title || letter);
		return `<div class="ev-col-header"><span class="ev-col-letter">${letter}</span><span class="ev-col-name">${name}</span></div>`;
	}

	/**
	 * Convert 0-based column index → Excel-style letter(s): 0→A, 25→Z, 26→AA …
	 */
	_col_idx_to_letter(n) {
		let result = "";
		n = n + 1;
		while (n > 0) {
			const rem = (n - 1) % 26;
			result = String.fromCharCode(65 + rem) + result;
			n = Math.floor((n - 1) / 26);
		}
		return result;
	}

	// ── Cell formatting (afterRenderer hook) ──────────────────────────────────

	/**
	 * Apply stored formatting (bold, italic, color, etc.) to a rendered cell TD.
	 * Called by HOT's afterRenderer hook after each cell is drawn.
	 */
	_apply_cell_format(TD, row, col, value) {
		// Join skeleton: shimmer animation while api.get_joined_data is in-flight
		if (this.columns[col]?._is_join_loading) {
			TD.classList.add("ev-cell-join-loading");
			return;
		}

		// docstatus: render 0/1/2 as a coloured badge instead of raw number
		if (this.columns[col]?._is_docstatus) {
			const v = parseInt(value, 10);
			const map = [
				{ label: "Draft",     cls: "ev-doc-draft"     },
				{ label: "Submitted", cls: "ev-doc-submitted"  },
				{ label: "Cancelled", cls: "ev-doc-cancelled"  },
			];
			const entry = map[v];
			TD.innerHTML = entry
				? `<span class="ev-doc-status ${entry.cls}">${__(entry.label)}</span>`
				: String(value ?? "");
			return;
		}

		// Formula display: replace raw formula string with the HyperFormula-computed result.
		// HOT stores the literal "=SUM(B1:B3)" string; we swap it with the evaluated value.
		// For V2.3 async ERP functions the value may be "#LOADING…", "#PERM_DENIED", "#ERR!",
		// or "#ARG!" — each gets a distinct CSS class for visual feedback.
		if (this.formula_bridge?.is_formula(value)) {
			const computed = this.formula_bridge.get_display_value(row, col);
			const display  = computed !== null && computed !== undefined ? String(computed) : "";
			TD.textContent = display;

			if (typeof computed === "number") {
				TD.classList.add("htRight"); // right-align numeric results like Excel
			} else if (display === "#LOADING\u2026") {
				TD.classList.add("ev-formula-loading");
			} else if (display === "#PERM_DENIED") {
				TD.classList.add("ev-formula-perm");
			} else if (display === "#ERR!" || display === "#ARG!") {
				TD.classList.add("ev-formula-error");
			}
		}

		// Apply stored per-cell formatting (bold, italic, color, etc.)
		// Always reset fill var first — prevents stale colour from prev render
		TD.style.removeProperty("--ev-cell-fill");

		const fmt = this.format_store?.[`${row}:${col}`];
		if (!fmt) return;

		if (fmt.bold) TD.style.fontWeight = "bold";
		if (fmt.italic) TD.style.fontStyle = "italic";

		const decs = [];
		if (fmt.underline) decs.push("underline");
		if (fmt.strike) decs.push("line-through");
		if (decs.length) TD.style.textDecoration = decs.join(" ");

		if (fmt.color) TD.style.color = fmt.color;
		if (fmt.bg) TD.style.setProperty("--ev-cell-fill", fmt.bg);
		if (fmt.align) TD.style.textAlign = fmt.align;
		if (fmt.size) TD.style.fontSize = fmt.size + "px";
		if (fmt.font) TD.style.fontFamily = fmt.font;
		if (fmt.wrap) TD.style.whiteSpace = "normal";
		TD.style.verticalAlign = fmt.valign || "middle";
	}

	// ── Event handlers ────────────────────────────────────────────────────────

	_on_change(changes, source) {
		if (!changes || source === "loadData") return;

		// In array-of-objects mode HOT gives [row, fieldname, oldVal, newVal].
		// formula_bridge needs numeric col indices, so convert.
		const indexed = changes.map(([row, prop, oldVal, newVal]) => {
			const col = this.columns.findIndex((c) => c.data === prop);
			return [row, col, oldVal, newVal];
		});

		// Push raw values into HyperFormula first (needed before copy/paste adjustment).
		this.formula_bridge.apply_changes(indexed);

		// For autofill: use HF copy+paste so relative references shift correctly.
		// (Without this, =AF1*0.18 copied to row 2 stays =AF1*0.18 instead of =AF2*0.18)
		if (source === "Autofill.fill") {
			this._fix_autofill_formulas(changes, indexed);
		}

		// Persist to Frappe DB
		this.data_manager.queue_save(changes);

		// Keep local data array in sync.
		// NOTE: for autofill formula cells, _fix_autofill_formulas already wrote the
		// adjusted formula back, so we skip those (don't overwrite with the unadjusted string).
		const is_autofill_formula = source === "Autofill.fill";
		changes.forEach(([row, prop, , newVal]) => {
			if (!this.list_view.data[row]) return;
			if (is_autofill_formula && this.formula_bridge.is_formula(newVal)) return;
			this.list_view.data[row][prop] = newVal;
		});
	}

	/**
	 * After HOT autofill, adjust relative formula references using HyperFormula's
	 * copy+paste API. HF computes the correctly-shifted formula for each target row/col.
	 *
	 * We self-detect the source row by checking which adjacent row already has a
	 * formula in HF (no reliance on beforeAutofill whose signature varies by HOT version).
	 *
	 * Example (fill-down from row 0):
	 *   row 1 → =AF2*0.18
	 *   row 2 → =AF3*0.18
	 */
	_fix_autofill_formulas(changes, indexed) {
		// Only handle single-column fills (standard fill-down / fill-up)
		const cols = new Set(indexed.map(([, c]) => c));
		if (cols.size !== 1) return;
		const col = [...cols][0];
		if (col < 0) return;

		// Filter to formula-only changes
		const formula_changes = indexed.filter(([, , , v]) => this.formula_bridge.is_formula(v));
		if (!formula_changes.length) return;

		const changed_rows = formula_changes.map(([r]) => r);
		const min_row = Math.min(...changed_rows);
		const max_row = Math.max(...changed_rows);

		// Source row is adjacent to the fill range and already holds a formula in HF.
		//   • fill-down: source is min_row - 1
		//   • fill-up:   source is max_row + 1
		let src_row = null;
		if (min_row > 0 && this.formula_bridge.get_formula(min_row - 1, col)) {
			src_row = min_row - 1;
		} else if (this.formula_bridge.get_formula(max_row + 1, col)) {
			src_row = max_row + 1;
		}
		if (src_row === null) return;

		const hf = this.formula_bridge.hf;
		const sheet = this.formula_bridge.sheet_id;

		try {
			// Copy source cell into HF's internal clipboard.
			// HF remembers relative offsets so each paste adjusts references correctly.
			hf.copy({
				start: { sheet, row: src_row, col },
				end:   { sheet, row: src_row, col },
			});

			let needs_render = false;

			formula_changes.forEach(([row, , , newVal]) => {
				// Paste — HF adjusts relative row/col references vs the source position
				hf.paste({ sheet, row, col });

				const adjusted = hf.getCellFormula({ sheet, row, col });
				if (adjusted && adjusted !== newVal) {
					const prop = this.columns[col]?.data;
					if (prop && this.list_view.data[row]) {
						this.list_view.data[row][prop] = adjusted;
					}
					needs_render = true;
				}
			});

			if (needs_render) this.hot.render();
		} catch (e) {
			console.warn("[ExcelView] autofill formula adjustment failed:", e);
		}
	}

	_on_selection(row, col, row2, col2) {
		this.formula_bar_component.update(row, col);
		this.toolbar_component?.sync(row, col);
		this.status_bar?.update(row, col, row2 ?? row, col2 ?? col);
	}

	_on_col_resize(col_index, new_width) {
		const widths = this.columns.map((_, i) => {
			const plugin = this.hot.getPlugin("manualColumnResize");
			return plugin.columnWidthsMap?.get(i) || this.columns[i]?.width || 140;
		});
		this.column_manager.save_widths(widths);
	}

	_on_render() {
		// Guard: afterRender fires during HOT's own init, before this.hot is assigned
		if (!this.hot) return;
		const sel = this.hot.getSelectedLast();
		if (sel) {
			this.formula_bar_component.update(sel[0], sel[1]);
			this.status_bar?.update(sel[0], sel[1], sel[2], sel[3]);
		}
	}

	// ── Keyboard shortcuts ────────────────────────────────────────────────────

	_bind_shortcuts() {
		$(document).on("keydown.ev", (e) => {
			if (!this._is_active()) return;

			const ctrl = e.ctrlKey || e.metaKey;

			// Ctrl+S → force save
			if (ctrl && e.key === "s") {
				e.preventDefault();
				this.data_manager._flush_saves();
				return;
			}

					// Ctrl+F → Find,  Ctrl+H → Find & Replace
			if (ctrl && e.key === "f") {
				e.preventDefault();
				this._show_find_replace("find");
				return;
			}
			if (ctrl && e.key === "h") {
				e.preventDefault();
				this._show_find_replace("replace");
				return;
			}

			// Formatting shortcuts — only when formula bar is NOT focused
			if (document.activeElement?.classList.contains("ev-formula-input")) return;

			if (ctrl && e.key === "b") {
				e.preventDefault();
				this.toolbar_component?.toggle("bold");
			}
			if (ctrl && e.key === "i") {
				e.preventDefault();
				this.toolbar_component?.toggle("italic");
			}
			if (ctrl && e.key === "u") {
				e.preventDefault();
				this.toolbar_component?.toggle("underline");
			}
		});
	}

	_is_active() {
		return this.list_view?.view_name === "Excel" && document.contains(this.$hot_container?.[0]);
	}

	// ── Column visibility ─────────────────────────────────────────────────────

	/**
	 * Hide the given column indices (visible-index space).
	 * Accepts an array so non-contiguous Ctrl+click selections are supported.
	 * @param {number[]} col_indices - array of visible column indices to hide
	 */
	_hide_columns(col_indices) {
		let count = 0;
		col_indices.forEach((c) => {
			const key = this.columns[c]?.data;
			if (key) { this._hidden_col_keys.add(key); count++; }
		});
		if (!count) return;
		this._sync_visible_columns();
		frappe.show_alert(
			{
				message: __(
					"{0} column(s) hidden — right-click → Show all columns to restore",
					[count]
				),
				indicator: "blue",
			},
			4
		);
	}

	/**
	 * Restore all hidden columns back to the visible set.
	 */
	_show_all_columns() {
		const count = this._hidden_col_keys.size;
		if (!count) {
			frappe.show_alert({ message: __("No hidden columns"), indicator: "orange" }, 2);
			return;
		}
		this._hidden_col_keys.clear();
		this._sync_visible_columns();
		frappe.show_alert(
			{ message: __("{0} column(s) restored", [count]), indicator: "green" },
			2
		);
	}

	/**
	 * Rebuild this.columns as the visible subset of _master_columns,
	 * then push the new column config to HOT and HyperFormula.
	 */
	_sync_visible_columns() {
		this.columns = this._master_columns.filter(
			(c) => !this._hidden_col_keys.has(c.data)
		);
		this.matrix = this.data_manager.to_matrix(this.list_view.data, this.columns);
		this.formula_bridge.reload(this.matrix);
		this.hot.updateSettings({ columns: this.columns });
		this.hot.render();
	}

	// ── Formula columns ───────────────────────────────────────────────────────

	/**
	 * Add a new "formula column" — a writable column not tied to any Frappe field.
	 * Users can enter formulas (=SUM, =IF, etc.) or plain values.
	 * These are never saved to the DB.
	 */
	_add_formula_column() {
		const idx = (this._formula_col_count = (this._formula_col_count || 0) + 1);
		const key = `__fml_${idx}__`;

		frappe.prompt(
			[
				{
					fieldtype: "Data",
					fieldname: "label",
					label: __("Column Name"),
					default: __("Formula {0}", [idx]),
					reqd: 1,
				},
			],
			({ label }) => {
				const new_col = {
					data: key,
					title: label,
					type: "text",
					width: 140,
					_is_formula_col: true,
				};

				this.columns.push(new_col);
				this._master_columns.push(new_col); // keep master in sync

				// Seed empty value into every data row so HOT can read/write the key
				(this.list_view.data || []).forEach((row) => {
					row[key] = "";
				});

				// Rebuild HyperFormula matrix with the new column
				this.matrix = this.data_manager.to_matrix(
					this.list_view.data,
					this.columns
				);
				this.formula_bridge.reload(this.matrix);

				// Re-apply column config to HOT
				this.hot.updateSettings({ columns: this.columns });
				this.hot.render();

				// Focus the first cell of the new column
				const new_col_idx = this.columns.length - 1;
				this.hot.selectCell(0, new_col_idx);

				frappe.show_alert(
					{
						message: __(
							'Formula column "{0}" added — enter values or formulas (=SUM, =IF…)',
							[label]
						),
						indicator: "blue",
					},
					4
				);
			},
			__("Add Formula Column"),
			__("Add")
		);
	}

	/**
	 * Remove formula columns that fall within the given col range.
	 * Frappe field columns are silently skipped — DB is never touched.
	 * @param {number} start_col - inclusive
	 * @param {number} end_col   - inclusive
	 */
	_remove_formula_columns(start_col, end_col) {
		const to_remove = [];
		for (let c = start_col; c <= end_col; c++) {
			if (this.columns[c]?._is_formula_col) to_remove.push(c);
		}

		if (!to_remove.length) {
			frappe.show_alert(
				{ message: __("Only formula columns can be removed"), indicator: "orange" },
				3
			);
			return;
		}

		// Remove in reverse order so earlier indices stay valid
		[...to_remove].reverse().forEach((c) => {
			const key = this.columns[c].data;
			this.columns.splice(c, 1);
			// Also remove from master list
			this._master_columns = this._master_columns.filter((col) => col.data !== key);
			(this.list_view.data || []).forEach((row) => delete row[key]);
		});

		// Sync HyperFormula + HOT
		this.matrix = this.data_manager.to_matrix(this.list_view.data, this.columns);
		this.formula_bridge.reload(this.matrix);
		this.hot.updateSettings({ columns: this.columns });
		this.hot.render();

		frappe.show_alert(
			{
				message: __("{0} formula column(s) removed", [to_remove.length]),
				indicator: "blue",
			},
			2
		);
	}

	// ── Find & Replace ─────────────────────────────────────────────────────────

	/**
	 * Open (or focus) the floating Find & Replace panel.
	 * @param {"find"|"replace"} focus_target  - which input to focus on open
	 */
	_show_find_replace(focus_target = "find") {
		if (!this.$fnr_panel) this._build_fnr_panel();
		this.$fnr_panel.addClass("ev-fnr-visible");
		const $input = focus_target === "replace"
			? this.$fnr_panel.find(".ev-fnr-replace-input")
			: this.$fnr_panel.find(".ev-fnr-find-input");
		$input.focus().select();
	}

	_build_fnr_panel() {
		this._fnr_results = [];
		this._fnr_idx = -1;

		this.$fnr_panel = $(`
			<div class="ev-fnr-panel">
				<div class="ev-fnr-header">
					<span>${__("Find & Replace")}</span>
					<button class="ev-fnr-close" title="${__("Close")}">&#x2715;</button>
				</div>
				<div class="ev-fnr-row">
					<label>${__("Find")}</label>
					<input type="text" class="ev-fnr-find-input" placeholder="${__("Search…")}">
				</div>
				<div class="ev-fnr-row">
					<label>${__("Replace")}</label>
					<input type="text" class="ev-fnr-replace-input" placeholder="${__("Replace with…")}">
				</div>
				<div class="ev-fnr-opts">
					<label><input type="checkbox" data-opt="match_case"> ${__("Match case")}</label>
					<label><input type="checkbox" data-opt="whole_cell"> ${__("Whole cell")}</label>
				</div>
				<div class="ev-fnr-status"></div>
				<div class="ev-fnr-btns">
					<button class="ev-fnr-btn ev-fnr-prev">${__("◄ Prev")}</button>
					<button class="ev-fnr-btn ev-fnr-next">${__("Next ►")}</button>
					<button class="ev-fnr-btn ev-fnr-replace">${__("Replace")}</button>
					<button class="ev-fnr-btn ev-fnr-primary ev-fnr-replace-all">${__("Replace All")}</button>
				</div>
			</div>
		`).appendTo(document.body);

		// ── Events ──────────────────────────────────────────────────────────────

		this.$fnr_panel.find(".ev-fnr-close").on("click", () => this._close_find_replace());

		this.$fnr_panel.find(".ev-fnr-find-input").on("keydown", (e) => {
			if (e.key === "Escape") { this._close_find_replace(); return; }
			if (e.key === "Enter") {
				e.preventDefault();
				e.shiftKey ? this._fnr_navigate(-1) : this._fnr_navigate(1);
			}
		});

		this.$fnr_panel.find(".ev-fnr-replace-input").on("keydown", (e) => {
			if (e.key === "Escape") { this._close_find_replace(); return; }
			if (e.key === "Enter") { e.preventDefault(); this._fnr_replace_one(); }
		});

		// Live re-query as the user types (debounced)
		const requery = frappe.utils.debounce(() => this._fnr_run_query(true), 200);
		this.$fnr_panel.find(".ev-fnr-find-input").on("input", requery);
		this.$fnr_panel.find("[data-opt]").on("change", requery);

		this.$fnr_panel.find(".ev-fnr-prev").on("click", () => this._fnr_navigate(-1));
		this.$fnr_panel.find(".ev-fnr-next").on("click", () => this._fnr_navigate(1));
		this.$fnr_panel.find(".ev-fnr-replace").on("click", () => this._fnr_replace_one());
		this.$fnr_panel.find(".ev-fnr-replace-all").on("click", () => this._fnr_replace_all());

		// ── Drag-to-reposition via header ────────────────────────────────────────
		let _drag_origin = null;
		this.$fnr_panel.find(".ev-fnr-header").on("mousedown", (e) => {
			if ($(e.target).is(".ev-fnr-close")) return;
			const rect = this.$fnr_panel[0].getBoundingClientRect();
			_drag_origin = { mx: e.clientX, my: e.clientY, px: rect.left, py: rect.top };
			e.preventDefault();
		});
		$(document).on("mousemove.fnr_drag", (e) => {
			if (!_drag_origin) return;
			const max_x = window.innerWidth  - this.$fnr_panel[0].offsetWidth;
			const max_y = window.innerHeight - this.$fnr_panel[0].offsetHeight;
			this.$fnr_panel.css({
				left: Math.max(0, Math.min(max_x, _drag_origin.px + e.clientX - _drag_origin.mx)) + "px",
				top:  Math.max(0, Math.min(max_y, _drag_origin.py + e.clientY - _drag_origin.my)) + "px",
				right: "auto",
			});
		});
		$(document).on("mouseup.fnr_drag", () => { _drag_origin = null; });
	}

	_close_find_replace() {
		this.$fnr_panel?.removeClass("ev-fnr-visible");
		// Clear HOT search highlights
		const plugin = this.hot?.getPlugin("search");
		if (plugin) { plugin.query(""); this.hot.render(); }
	}

	/**
	 * Run HOT search plugin with current query + options.
	 * @param {boolean} reset_idx - reset current-match pointer to start
	 */
	_fnr_run_query(reset_idx = false) {
		const query = this.$fnr_panel.find(".ev-fnr-find-input").val();
		const plugin = this.hot.getPlugin("search");
		if (!query) {
			this._fnr_results = [];
			if (reset_idx) this._fnr_idx = -1;
			plugin.query("");
			this.hot.render();
			this._fnr_update_status();
			return;
		}

		const match_case = this.$fnr_panel.find('[data-opt="match_case"]').is(":checked");
		const whole_cell = this.$fnr_panel.find('[data-opt="whole_cell"]').is(":checked");

		const query_method = (q, val) => {
			const s = val?.toString() ?? "";
			const [a, b] = match_case ? [s, q] : [s.toLowerCase(), q.toLowerCase()];
			return whole_cell ? a === b : a.includes(b);
		};

		this._fnr_results = plugin.query(query, null, query_method);
		if (reset_idx) this._fnr_idx = -1;
		this.hot.render();
		this._fnr_update_status();
	}

	/**
	 * Navigate to the next (+1) or previous (-1) search match.
	 * @param {1|-1} direction
	 */
	_fnr_navigate(direction) {
		this._fnr_run_query(false);
		const n = this._fnr_results.length;
		if (!n) { this._fnr_update_status(__("No matches")); return; }
		this._fnr_idx = ((this._fnr_idx + direction) % n + n) % n;
		const { row, col } = this._fnr_results[this._fnr_idx];
		this.hot.selectCell(row, col);
		this._fnr_update_status();
	}

	/** Replace the currently selected match and advance to the next. */
	_fnr_replace_one() {
		if (!this.list_view.can_write) {
			frappe.show_alert({ message: __("No write permission"), indicator: "red" }, 2);
			return;
		}
		const sel = this.hot.getSelected()?.[0];
		if (!sel) { this._fnr_navigate(1); return; }
		const row = sel[0], col = sel[1];
		// Only replace if this cell is actually a search match
		const is_match = this._fnr_results.some((m) => m.row === row && m.col === col);
		if (!is_match) { this._fnr_navigate(1); return; }
		// Use HOT's getCellMeta — covers both _readonly columns AND permission-based readonly
		if (this.hot.getCellMeta(row, col).readOnly) { this._fnr_navigate(1); return; }
		const replace_val = this.$fnr_panel.find(".ev-fnr-replace-input").val();
		this.hot.setDataAtCell(row, col, replace_val);
		this._fnr_run_query(false);
		this._fnr_navigate(1);
	}

	/** Replace every non-readonly match in one batch operation. */
	_fnr_replace_all() {
		if (!this.list_view.can_write) {
			frappe.show_alert({ message: __("No write permission"), indicator: "red" }, 2);
			return;
		}
		this._fnr_run_query(true);
		if (!this._fnr_results.length) {
			frappe.show_alert({ message: __("Nothing to replace"), indicator: "orange" }, 2);
			return;
		}
		const replace_val = this.$fnr_panel.find(".ev-fnr-replace-input").val();
		const changes = this._fnr_results
			.filter(({ row, col }) => !this.hot.getCellMeta(row, col).readOnly)
			.map(({ row, col }) => [row, col, replace_val]);
		if (changes.length) {
			this.hot.setDataAtCell(changes);
			frappe.show_alert(
				{ message: __("{0} cell(s) replaced", [changes.length]), indicator: "green" },
				3
			);
		}
		this._fnr_run_query(true);
	}

	_fnr_update_status(override_msg = null) {
		const $s = this.$fnr_panel.find(".ev-fnr-status");
		if (override_msg) { $s.text(override_msg); return; }
		const n = this._fnr_results.length;
		const q = this.$fnr_panel.find(".ev-fnr-find-input").val();
		if (!q)  { $s.text(""); return; }
		if (!n)  { $s.text(__("No matches")); return; }
		if (this._fnr_idx < 0) { $s.text(__("{0} match(es) found", [n])); return; }
		$s.text(__("{0} of {1}", [this._fnr_idx + 1, n]));
	}

	// ── Column freeze ─────────────────────────────────────────────────────────

	/**
	 * Set or clear the column freeze boundary.
	 * @param {number} n - columns to freeze (0 = unfreeze)
	 */
	_set_freeze(n) {
		this._frozen_cols = n;
		this.hot.updateSettings({ fixedColumnsLeft: n });
		this.column_manager.save_freeze(n);
		// CSS class drives the freeze-boundary green border (border only when frozen)
		this.$hot_container.toggleClass("ev-cols-frozen", n > 0);

		frappe.show_alert(
			n > 0
				? { message: __("{0} column(s) frozen", [n]), indicator: "green" }
				: { message: __("Columns unfrozen"), indicator: "blue" },
			2
		);
	}

	// ── Row height management ─────────────────────────────────────────────────

	/**
	 * Recalculate and apply row heights for the given row range based on
	 * the maximum font size stored in format_store for that row.
	 * Called by the toolbar after font size / bold / wrap changes.
	 *
	 * Formula: max_font_px * 1.6 + 4  (matches Excel's default line height ratio).
	 * Minimum: 23px (HOT default row height).
	 */
	refresh_row_heights(r1 = 0, r2 = null) {
		const total = this.hot?.countRows() ?? 0;
		if (!total) return;
		const end = r2 ?? total - 1;
		const col_count = this.columns.length;
		const plugin = this.hot.getPlugin("manualRowResize");
		if (!plugin) return;

		for (let r = r1; r <= end; r++) {
			let max_size = 0;
			for (let c = 0; c < col_count; c++) {
				const size = this.format_store?.[`${r}:${c}`]?.size;
				if (size && size > max_size) max_size = size;
			}
			const needed = max_size ? Math.ceil(max_size * 1.6) + 4 : 23;
			plugin.setManualSize(r, Math.max(23, needed));
		}
		this.hot.render();
	}

	// ── IntelliFlow — Join Canvas (V2.4) ─────────────────────────────────────

	/**
	 * Open the IntelliFlow visual join canvas overlay.
	 * Replaces any previously open canvas instance.
	 */
	_open_join_canvas() {
		this.join_canvas?.close();
		this.join_canvas = new frappe.views.excel.JoinCanvas({ board: this });
		// If a join config is already active (loaded workbook or previous Apply),
		// pass it so the canvas opens with existing nodes/connections visible.
		this.join_canvas.open(this._last_join_config || null);
	}

	/**
	 * Inject joined rows (from api.get_joined_data) as read-only virtual columns.
	 * Called by JoinCanvas after "Apply" completes, or by _reapply_join_from_config
	 * after a workbook is loaded.
	 *
	 * @param {Object[]} joined_rows  - flat rows: [{name, "DocType__field": value, ...}]
	 * @param {Object}   join_config  - the serialised join_config from the canvas
	 */
	_apply_join_result(joined_rows, join_config) {
		// Persist for workbook save (WorkbookManager.get_config reads this).
		// Stored WITHOUT base_names (those are dynamic per-session).
		this._last_join_config = join_config;

		// Clear skeleton loading flag — shimmer stops, afterRenderer no longer
		// applies ev-cell-join-loading class.
		this.columns.forEach(c => { if (c._is_join_loading) delete c._is_join_loading; });
		this._master_columns.forEach(c => { if (c._is_join_loading) delete c._is_join_loading; });

		// Build name → joined-field values lookup
		const by_name = Object.fromEntries(joined_rows.map(r => [r.name, r]));

		// Merge joined fields into every existing data row
		this.list_view.data.forEach(doc => Object.assign(doc, by_name[doc.name] || {}));

		// If the user selected specific base-node fields in the canvas, filter columns.
		// Always keep: name col, formula cols, existing join cols, hidden-col metadata.
		if (join_config.base_selected_fields?.length) {
			const keep = new Set(join_config.base_selected_fields);
			this.columns = this.columns.filter(c =>
				c._is_join_col || c._is_formula_col || c._is_name_col ||
				c.data === "name" || keep.has(c.data)
			);
			this._master_columns = [...this.columns];
			this._hidden_col_keys.clear();
		}

		// Add/update a read-only virtual column for each selected field on each edge.
		// If skeleton columns were pre-added by _add_join_skeleton_columns, we update
		// their titles (now that meta is loaded) instead of adding duplicates.
		const nodes_by_id = Object.fromEntries(join_config.nodes.map(n => [n.id, n]));
		join_config.edges.forEach(edge => {
			const tgt_node = nodes_by_id[edge.tgt_node_id];
			if (!tgt_node) return;
			edge.selected_fields.forEach(field => {
				const key = `${tgt_node.doctype}__${field}`;
				// Use Frappe meta label (e.g. "Date of Joining") instead of raw fieldname
				const df = frappe.get_meta(tgt_node.doctype)?.fields?.find(f => f.fieldname === field);
				const field_label = df?.label || field;
				const title = `${tgt_node.doctype}: ${field_label}`;

				const existing = this.columns.find(c => c.data === key);
				if (existing) {
					// Update label — skeleton may have used raw fieldname if meta wasn't ready
					existing.title = title;
					const master_existing = this._master_columns.find(c => c.data === key);
					if (master_existing) master_existing.title = title;
					return;
				}
				// Column wasn't pre-added (e.g. direct canvas Apply) — add it now
				const col = {
					data:          key,
					title,
					type:          "text",
					width:         160,
					readOnly:      true,
					_readonly:     true,
					_is_join_col:  true,
				};
				this.columns.push(col);
				this._master_columns.push(col);
			});
		});

		// Sync HyperFormula matrix + HOT
		this.matrix = this.data_manager.to_matrix(this.list_view.data, this.columns);
		this.formula_bridge.reload(this.matrix);
		this.hot.updateSettings({ columns: this.columns });
		this.hot.loadData(this.list_view.data);

		frappe.show_alert({ message: __("Join applied"), indicator: "green" }, 2);
	}

	/**
	 * Re-execute a join from a saved config (workbook restore or pending_join_config).
	 * Called from refresh() when _pending_join_config is set after a workbook load.
	 *
	 * @param {Object} cfg - join_config (without base_names — those are rebuilt here)
	 */
	_reapply_join_from_config(cfg) {
		if (this._destroyed) return;
		const loaded_data = this.list_view.data || [];
		if (!loaded_data.length || !cfg.edges?.length) return;

		// Load meta for all target doctypes first (so labels work in _apply_join_result)
		const tgt_doctypes = (cfg.nodes || [])
			.filter(n => n.doctype !== this.doctype)
			.map(n => n.doctype);

		const _do_join = () => {
			if (this._destroyed) return;
			frappe.call({
				method: "excel_view.api.get_joined_data",
				args: {
					base_doctype: this.doctype,
					join_config:  JSON.stringify({
						...cfg,
						base_names: (this.list_view.data || []).map(d => d.name),
					}),
					limit: (this.list_view.data || []).length + 100,
				},
				freeze: false,
				callback: (r) => {
					if (this._destroyed) return;
					this._apply_join_result(r.message || [], cfg);
				},
			});
		};

		if (!tgt_doctypes.length) {
			_do_join();
			return;
		}
		// Ensure all target DocType metas are loaded before applying (for column labels)
		let pending = tgt_doctypes.length;
		tgt_doctypes.forEach(dt => {
			frappe.model.with_doctype(dt, () => {
				if (--pending === 0) _do_join();
			});
		});
	}

	// ── Field picker ──────────────────────────────────────────────────────────

	/**
	 * Open the "Choose Columns" dialog.
	 */
	open_field_picker() {
		new frappe.views.excel.FieldPicker({ board: this }).open();
	}

	/**
	 * Apply a new column selection from the field picker.
	 *
	 * @param {string[]} fieldnames - ordered array, always starts with "name"
	 * @param {Object}  [opts]
	 * @param {boolean} [opts.silent=false] - if true, skip the list_view.refresh()
	 *   call.  Used by WorkbookManager.apply_config() which triggers its OWN single
	 *   refresh at the end — suppressing the implicit refresh here avoids the race
	 *   condition where two concurrent board.refresh() calls interleave and wipe the
	 *   joined-row values that were just merged into list_view.data.
	 */
	apply_field_selection(fieldnames, { silent = false } = {}) {
		// Rebuild column_manager's field list (name is added automatically by get_columns)
		this.column_manager.fields = fieldnames
			.filter(f => f !== "name")
			.map(f => [f, this.doctype]);

		// Recompute columns + master list; clear any hidden-column state
		this.columns = this.column_manager.get_columns();
		this._master_columns = [...this.columns];
		this._hidden_col_keys.clear();

		// Push the new column headers to HOT immediately so the UI updates.
		this.hot.updateSettings({ columns: this.columns });

		// CRITICAL: update list_view.fields so the next server fetch includes
		// the newly selected fields. Without this, data for new columns never
		// arrives — the server returns only the fields it was originally asked for.
		this.list_view.fields = [
			["name", this.doctype],
			...this.column_manager.fields,
		];

		if (silent) return;

		// Force a fresh data fetch — bypass no_change throttle.
		// render() → board.refresh(data) will reload the matrix + HF + HOT data.
		this.list_view.last_args = null;
		this.list_view.start = 0;
		this.list_view.refresh();
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Reload grid with fresh data from the server.
	 */
	refresh(new_data) {
		this.data = new_data;
		this.matrix = this.data_manager.to_matrix(new_data, this.columns);
		this.formula_bridge.reload(this.matrix);
		// V2.3 — clear async formula cache on every data reload so cells
		// don't show stale values after filters change or "Load More" fires.
		frappe.views.excel.formula_manager?.clear();
		this.hot.loadData(new_data);

		// V2.4 — Re-apply join data whenever the grid refreshes.
		//
		// _pending_join_config: one-shot flag set by WorkbookManager.apply_config().
		//   Shows skeleton columns immediately, then fetches real join data.
		//
		// _last_join_config: persists for the lifetime of the board after the first
		//   Apply (or workbook load).  Frappe's idle auto-refresh calls
		//   frappe.desk.reportview.get which returns only base-doctype rows — join
		//   column values are wiped from every row.  We re-fetch silently here so
		//   the grid never shows empty join cells after an idle refresh.
		if (this._pending_join_config) {
			const cfg = this._pending_join_config;
			this._pending_join_config = null;
			// Pre-add skeleton columns immediately — headers appear right away with
			// a shimmer animation while the async API call runs in the background.
			this._add_join_skeleton_columns(cfg);
			// Defer the full re-apply (meta load + API call) one tick
			setTimeout(() => this._reapply_join_from_config(cfg), 0);
		} else if (this._last_join_config) {
			// Subsequent refresh (idle auto-refresh, filter change, Load More…).
			// Columns already exist — just re-fill row values from the API.
			const cfg = this._last_join_config;
			setTimeout(() => this._reapply_join_from_config(cfg), 0);
		}
	}

	/**
	 * Pre-add skeleton join columns synchronously from a saved join_config.
	 * Columns appear instantly with a shimmer; real data fills them once
	 * _reapply_join_from_config → _apply_join_result completes.
	 *
	 * @param {Object} cfg - join_config (nodes + edges with selected_fields)
	 */
	_add_join_skeleton_columns(cfg) {
		if (!cfg?.edges?.length) return;
		const nodes_by_id = Object.fromEntries((cfg.nodes || []).map(n => [n.id, n]));
		let added = 0;

		cfg.edges.filter(e => e.selected_fields?.length).forEach(edge => {
			const tgt_node = nodes_by_id[edge.tgt_node_id];
			if (!tgt_node) return;
			edge.selected_fields.forEach(field => {
				const key = `${tgt_node.doctype}__${field}`;
				if (this.columns.find(c => c.data === key)) return; // already present
				// Use meta label if the DocType is already in the cache, else raw name
				const df = frappe.get_meta(tgt_node.doctype)?.fields?.find(f => f.fieldname === field);
				const col = {
					data:             key,
					title:            `${tgt_node.doctype}: ${df?.label || field}`,
					type:             "text",
					width:            160,
					readOnly:         true,
					_readonly:        true,
					_is_join_col:     true,
					_is_join_loading: true,   // cleared by _apply_join_result
				};
				this.columns.push(col);
				this._master_columns.push(col);
				// Seed empty value so HOT rows have the key defined
				(this.list_view.data || []).forEach(row => { row[key] = ""; });
				added++;
			});
		});

		if (added) {
			this.matrix = this.data_manager.to_matrix(this.list_view.data, this.columns);
			this.formula_bridge.reload(this.matrix);
			this.hot.updateSettings({ columns: this.columns });
			this.hot.loadData(this.list_view.data);
		}
	}

	/**
	 * Force HOT to re-render (e.g. after sidebar toggle resizes the container).
	 */
	resize() {
		this.hot?.render();
	}

	/**
	 * Destroy HOT instance and unbind all events.
	 * Called when navigating away from Excel View.
	 */
	destroy() {
		this._destroyed = true;
		this._last_join_config    = null;
		this._pending_join_config = null;
		$(document).off("keydown.ev");
		this._resize_observer?.disconnect();
		this.toolbar_component?.destroy();
		this.formula_bar_component?.destroy();
		this.status_bar?.destroy();
		this.workbook_manager?.destroy();
		this.hot?.destroy();
		this.hot = null;
		this.$wrapper?.empty();
	}
};
