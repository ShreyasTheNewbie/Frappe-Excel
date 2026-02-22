/**
 * excel_view/utils/formula_bridge.js
 *
 * Manual bridge between HyperFormula (MIT) and Handsontable 6.x.
 * HOT 8+ has a built-in formulas plugin; 6.x needs this manual wiring.
 *
 * Responsibilities:
 *  - Maintain a HyperFormula sheet synced with HOT's data matrix.
 *  - Evaluate formula cells (=SUM, =IF, etc.) before HOT renders them.
 *  - Provide raw formula string to the formula bar.
 *  - Apply cell changes from HOT back into HF for re-evaluation.
 */

import { HyperFormula } from "hyperformula";

frappe.provide("frappe.views.excel");

frappe.views.excel.FormulaBridge = class FormulaBridge {
	/**
	 * @param {Object} opts
	 * @param {Object} opts.board - ExcelBoard instance (for access to hot + columns)
	 */
	constructor(opts) {
		this.board = opts.board;
		this.hf = null;
		this.sheet_id = null;
		this._sheet_name = "Sheet1";
	}

	/**
	 * Initialize HyperFormula with the initial data matrix.
	 * @param {Array[]} matrix - 2D array of raw values (strings, numbers, formulas)
	 */
	init(matrix) {
		// gpl-v3 licenseKey = free use for open-source projects
		// Note: language defaults to "enUS" (always registered). Frappe uses "en"
		// which is NOT a valid HyperFormula locale name, so we omit the option.
		this.hf = HyperFormula.buildEmpty({
			licenseKey: "gpl-v3",
		});

		// HyperFormula v2.x: addSheet() returns the sheet name string,
		// not an object. Fetch the numeric ID with getSheetId().
		this.hf.addSheet(this._sheet_name);
		this.sheet_id = this.hf.getSheetId(this._sheet_name);

		// Populate HF with the entire initial matrix
		if (matrix && matrix.length) {
			this.hf.setSheetContent(this.sheet_id, this._prepare_for_hf(matrix));
		}
	}

	/**
	 * Fully reload HF sheet content (called when data refreshes from server).
	 * @param {Array[]} matrix
	 */
	reload(matrix) {
		if (!this.hf) {
			this.init(matrix);
			return;
		}
		this.hf.setSheetContent(this.sheet_id, this._prepare_for_hf(matrix));
	}

	/**
	 * Apply HOT afterChange changes to HF for re-evaluation.
	 * @param {Array[]} changes - HOT changes: [[row, col, oldVal, newVal], ...]
	 */
	apply_changes(changes) {
		if (!this.hf || !changes) return;

		const updates = changes
			.filter(([, , , newVal]) => newVal !== null && newVal !== undefined)
			.map(([row, col, , newVal]) => ({
				address: { sheet: this.sheet_id, row, col },
				newValue: this._coerce(newVal),
			}));

		if (!updates.length) return;

		this.hf.batch(() => {
			updates.forEach(({ address, newValue }) => {
				this.hf.setCellContents(address, [[newValue]]);
			});
		});
	}

	/**
	 * Get the computed display value for a cell.
	 * Returns HF-evaluated result for formula cells, raw value otherwise.
	 * @param {number} row
	 * @param {number} col
	 * @returns {string|number|boolean|null}
	 */
	get_display_value(row, col) {
		if (!this.hf) return null;
		const addr = { sheet: this.sheet_id, row, col };
		const formula = this.hf.getCellFormula(addr);
		if (formula) {
			const result = this.hf.getCellValue(addr);
			// HF returns error objects for invalid formulas
			if (result && typeof result === "object" && result.type) {
				return "#" + result.type; // e.g. #DIV/0!, #REF!
			}
			return result;
		}
		// Not a formula — return raw value from matrix
		return this.board.matrix?.[row]?.[col] ?? "";
	}

	/**
	 * Get the raw formula string for a cell (for formula bar display).
	 * Returns null if the cell doesn't contain a formula.
	 * @param {number} row
	 * @param {number} col
	 * @returns {string|null}
	 */
	get_formula(row, col) {
		if (!this.hf) return null;
		return this.hf.getCellFormula({ sheet: this.sheet_id, row, col }) || null;
	}

	/**
	 * Check if a value is a formula string.
	 * @param {*} value
	 * @returns {boolean}
	 */
	is_formula(value) {
		return typeof value === "string" && value.trim().startsWith("=");
	}

	/**
	 * Validate a formula string via HF.
	 * @param {string} formula
	 * @returns {{ valid: boolean, error: string|null }}
	 */
	validate_formula(formula) {
		if (!this.hf || !this.is_formula(formula)) {
			return { valid: true, error: null };
		}
		try {
			const result = this.hf.validateFormula(formula);
			return { valid: result, error: result ? null : __("Invalid formula") };
		} catch (e) {
			return { valid: false, error: e.message };
		}
	}

	/**
	 * Get list of all supported formula names (for autocomplete).
	 * @returns {string[]}
	 */
	get_formula_names() {
		if (!this.hf) return [];
		return this.hf.getAllFunctionPlugins
			? Object.keys(this.hf.getRegisteredFunctionNames?.() || {})
			: [];
	}

	// ── Private ──────────────────────────────────────────────────────────────

	/**
	 * Prepare matrix for HF: coerce each value to a type HF understands.
	 */
	_prepare_for_hf(matrix) {
		return matrix.map((row) => row.map((v) => this._coerce(v)));
	}

	/**
	 * Coerce a raw value to a HyperFormula-compatible type.
	 * Formulas stay as strings (HF parses them). Numbers become numbers.
	 * Null/undefined become empty string.
	 */
	_coerce(value) {
		if (value === null || value === undefined) return "";
		if (typeof value === "boolean") return value ? 1 : 0;
		if (this.is_formula(value)) return value; // pass formula as-is
		const num = Number(value);
		if (!isNaN(num) && value !== "") return num;
		return String(value);
	}
};
