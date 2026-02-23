/**
 * excel_view/components/column_manager.js
 *
 * Builds Handsontable column definitions from Frappe DocType meta.
 * Also provides column header labels and manages column width persistence.
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.ColumnManager = class ColumnManager {
	/**
	 * @param {Object} opts
	 * @param {Object} opts.board     - ExcelBoard instance
	 * @param {Object} opts.meta      - Frappe DocType meta object
	 * @param {Array}  opts.fields    - [[fieldname, doctype], ...] from BaseList
	 * @param {boolean} opts.can_write
	 */
	constructor(opts) {
		this.board = opts.board;
		this.meta = opts.meta;
		this.fields = opts.fields || [];
		this.can_write = opts.can_write;

		// Saved column widths: { fieldname: width_in_px }
		this._widths = this._load_widths();
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Build and return HOT column config array.
	 * Column order follows this.fields (same order as reportview.get).
	 * The `name` column is always prepended.
	 * @returns {Object[]}
	 */
	get_columns() {
		const columns = [];

		// Always show the ID/name column first (read-only)
		columns.push({
			...frappe.views.excel.get_name_column_config(this.meta.name),
			width: this._widths["name"] || 120,
		});

		// Add columns for each fetched field (skip "name" — already added)
		this.fields.forEach(([fieldname, doctype]) => {
			if (fieldname === "name") return;
			const df = this._get_df(fieldname, doctype);
			if (!df) return;

			const col_config = frappe.views.excel.get_column_config(df, this.can_write);
			col_config.width = this._widths[fieldname] || this._default_width(df);

			// docstatus: always read-only, render as badge (handled in afterRenderer)
			if (fieldname === "docstatus") {
				col_config.readOnly = true;
				col_config._readonly = true;
				col_config._is_docstatus = true;
				col_config.className = "htDimmed htCenter";
			}

			columns.push(col_config);
		});

		return columns;
	}

	/**
	 * Returns an array of plain-string column header labels (for HOT `colHeaders`).
	 * @param {Object[]} columns - output of get_columns()
	 * @returns {string[]}
	 */
	get_headers(columns) {
		return (columns || this.get_columns()).map((col) => col.title || col.data);
	}

	/**
	 * Persist column widths after HOT `afterColumnResize` event.
	 * @param {number[]} new_widths - array of widths in px (same order as columns)
	 */
	save_widths(new_widths) {
		const columns = this.board.columns;
		const widths = {};
		new_widths.forEach((w, i) => {
			if (columns[i]) widths[columns[i].data] = w;
		});
		this._widths = { ...this._widths, ...widths };
		frappe.model.user_settings.save(
			this.meta.name,
			"excel_view_col_widths",
			this._widths
		);
	}

	// ── Private ───────────────────────────────────────────────────────────────

	/**
	 * Find the DocField descriptor for a given fieldname.
	 * @param {string} fieldname
	 * @param {string} doctype
	 * @returns {Object|null}
	 */
	_get_df(fieldname, doctype) {
		const target_meta =
			doctype === this.meta.name
				? this.meta
				: frappe.get_meta(doctype);

		if (!target_meta) return null;

		return (
			target_meta.fields?.find((f) => f.fieldname === fieldname) ||
			// std fields (modified, owner, etc.)
			frappe.model.std_fields.find((f) => f.fieldname === fieldname) ||
			null
		);
	}

	/**
	 * Sensible default column width based on fieldtype.
	 * @param {Object} df
	 * @returns {number} width in px
	 */
	_default_width(df) {
		const type_widths = {
			Check: 60,
			Int: 80,
			Float: 100,
			Currency: 120,
			Percent: 80,
			Date: 110,
			Datetime: 160,
			Time: 90,
			Select: 130,
			Link: 140,
			"Dynamic Link": 140,
			Text: 200,
			"Small Text": 200,
			"Long Text": 250,
			Data: 150,
		};
		return type_widths[df.fieldtype] || 140;
	}

	/**
	 * Load persisted column widths from user settings.
	 * @returns {Object}
	 */
	_load_widths() {
		const settings = frappe.get_user_settings(this.meta.name);
		return settings?.excel_view_col_widths || {};
	}
};
