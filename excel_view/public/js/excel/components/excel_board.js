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

		// 2. Build columns + matrix
		this.columns = this.column_manager.get_columns();
		// _master_columns is the authoritative list of ALL columns (visible + hidden).
		// this.columns = visible subset. Slicing keeps them independent.
		this._master_columns = [...this.columns];
		this._hidden_col_keys = new Set(); // data keys of hidden columns
		this.matrix = this.data_manager.to_matrix(this.data, this.columns);

		// 3. Initialise formula engine
		this.formula_bridge.init(this.matrix);

		// 4. Render formula bar + toolbar
		this.formula_bar_component.setup();
		this.toolbar_component?.setup();

		// 5. Build HOT container and initialise
		this._init_container();
		this._init_hot();

		// 6. Keyboard shortcuts
		this._bind_shortcuts();
	}

	_init_container() {
		this.$wrapper = $(this.wrapper);
		this.$wrapper.empty().addClass("ev-grid-wrapper");

		this.$hot_container = $('<div class="ev-hot-container">').appendTo(this.$wrapper);
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
			manualRowResize: false,
			columnSorting: true,
			allowInsertRow: this.list_view.can_create,
			allowRemoveRow: this.list_view.can_write,
			copyPaste: true,
			undo: true,
			search: true,
			comments: true,
			observeChanges: false,

			// AutoFilter
			filters: true,
			dropdownMenu: true,

			// Context menu (right-click)
			contextMenu: this.context_menu.get_config(),

			// Layout
			height: "calc(100vh - 340px)",
			stretchH: "all",
			wordWrap: false,
			autoWrapRow: false,
			autoWrapCol: false,

			// Cell-level meta (readOnly, className)
			cells: (row, col) => this.data_manager.get_cell_meta(row, col),

			// Hooks
			afterChange: (changes, source) => this._on_change(changes, source),
			afterSelection: (r, c) => this._on_selection(r, c),
			afterColumnResize: (col, size) => this._on_col_resize(col, size),
			afterRender: () => this._on_render(),
			afterRenderer: (TD, row, col, prop, value) => this._apply_cell_format(TD, row, col, value),

			// i18n
			language: frappe.boot.lang === "ar" || frappe.boot.lang === "he" ? "ar-AR" : undefined,
		});
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
		// Formula display: replace raw formula string with the HyperFormula-computed result.
		// HOT stores the literal "=SUM(B1:B3)" string; we swap it with the evaluated value.
		if (this.formula_bridge?.is_formula(value)) {
			const computed = this.formula_bridge.get_display_value(row, col);
			const display = computed !== null && computed !== undefined ? String(computed) : "";
			TD.textContent = display;
			if (typeof computed === "number") {
				TD.classList.add("htRight"); // right-align numeric results like Excel
			}
		}

		// Apply stored per-cell formatting (bold, italic, color, etc.)
		const fmt = this.format_store?.[`${row}:${col}`];
		if (!fmt) return;

		if (fmt.bold) TD.style.fontWeight = "bold";
		if (fmt.italic) TD.style.fontStyle = "italic";

		const decs = [];
		if (fmt.underline) decs.push("underline");
		if (fmt.strike) decs.push("line-through");
		if (decs.length) TD.style.textDecoration = decs.join(" ");

		if (fmt.color) TD.style.color = fmt.color;
		if (fmt.bg) TD.style.backgroundColor = fmt.bg;
		if (fmt.align) TD.style.textAlign = fmt.align;
		if (fmt.size) TD.style.fontSize = fmt.size + "px";
		if (fmt.font) TD.style.fontFamily = fmt.font;
		if (fmt.wrap) TD.style.whiteSpace = "normal";
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

	_on_selection(row, col) {
		this.formula_bar_component.update(row, col);
		this.toolbar_component?.sync(row, col);
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

			// Ctrl+F → search
			if (ctrl && e.key === "f") {
				e.preventDefault();
				this._show_search();
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

	_show_search() {
		const plugin = this.hot.getPlugin("search");
		if (!plugin) return;

		frappe.prompt(
			{ fieldtype: "Data", fieldname: "query", label: __("Search") },
			({ query }) => {
				const results = plugin.query(query);
				if (!results.length) {
					frappe.show_alert({ message: __("Not found"), indicator: "orange" }, 2);
				} else {
					this.hot.selectCell(results[0].row, results[0].col);
				}
			},
			__("Search in grid"),
			__("Search")
		);
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Reload grid with fresh data from the server.
	 */
	refresh(new_data) {
		this.data = new_data;
		this.matrix = this.data_manager.to_matrix(new_data, this.columns);
		this.formula_bridge.reload(this.matrix);
		this.hot.loadData(new_data);
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
		$(document).off("keydown.ev");
		this.toolbar_component?.destroy();
		this.formula_bar_component?.destroy();
		this.hot?.destroy();
		this.hot = null;
		this.$wrapper?.empty();
	}
};
