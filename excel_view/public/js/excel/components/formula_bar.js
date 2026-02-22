/**
 * excel_view/components/formula_bar.js
 *
 * Renders the Excel-style formula bar above the grid:
 *
 *  ┌──────────┬────────────────────────────────────────────────┐
 *  │  A1      │  =SUM(A1:A10)  or  raw value                   │
 *  └──────────┴────────────────────────────────────────────────┘
 *   address     formula/value input
 *
 * Updates on HOT `afterSelection`. On formula input, pushes changes back to HOT.
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.FormulaBar = class FormulaBar {
	/**
	 * @param {Object} opts
	 * @param {Object} opts.board     - ExcelBoard instance
	 * @param {Element} opts.wrapper  - DOM element to render into
	 */
	constructor(opts) {
		this.board = opts.board;
		this.wrapper = opts.wrapper;
		this._current_row = 0;
		this._current_col = 0;
		this._editing = false;
	}

	// ── Setup ─────────────────────────────────────────────────────────────────

	setup() {
		this._render();
		this._bind_events();
	}

	_render() {
		$(this.wrapper).html(`
			<div class="ev-formula-bar">
				<div class="ev-cell-address" title="${__("Cell address")}">
					<input class="ev-address-input" type="text" readonly
						placeholder="A1" spellcheck="false" />
				</div>
				<div class="ev-fx-icon ev-fx-help" title="${__("Formula Help — click for examples")}">
					<span>f<sub>x</sub></span>
				</div>
				<div class="ev-formula-input-wrap">
					<input class="ev-formula-input" type="text"
						placeholder="${__("Value or formula (=SUM, =IF, ...)")}"
						spellcheck="false" />
				</div>
			</div>
		`);

		this.$address = $(this.wrapper).find(".ev-address-input");
		this.$formula = $(this.wrapper).find(".ev-formula-input");
	}

	_bind_events() {
		// On Enter in formula input → push value to HOT cell
		this.$formula.on("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this._commit();
				this.board.hot?.selectCell(this._current_row, this._current_col);
			}
			if (e.key === "Escape") {
				this._cancel();
				this.board.hot?.selectCell(this._current_row, this._current_col);
			}
		});

		// Track focus state
		this.$formula.on("focus", () => {
			this._editing = true;
		});

		this.$formula.on("blur", () => {
			if (this._editing) {
				this._commit();
				this._editing = false;
			}
		});

		// Address box: navigate to named cell on Enter
		this.$address.removeAttr("readonly").on("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this._navigate_to_address(this.$address.val().trim());
			}
		});

		// fx button click → formula help popup
		$(this.wrapper).find(".ev-fx-help").on("click", () => this._show_formula_help());
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Update bar to reflect the currently selected HOT cell.
	 * Called from ExcelBoard's afterSelection hook.
	 * @param {number} row
	 * @param {number} col
	 */
	update(row, col) {
		if (this._editing) return; // don't interrupt user input
		this._current_row = row;
		this._current_col = col;

		// Update address box: convert 0-based row/col → Excel-style A1 notation
		this.$address.val(this._to_cell_address(row, col));

		// Show formula string if cell has a formula, otherwise raw value
		const bridge = this.board.formula_bridge;
		const formula = bridge?.get_formula(row, col);
		if (formula) {
			this.$formula.val(formula);
		} else {
			const raw = this.board.matrix?.[row]?.[col] ?? "";
			this.$formula.val(raw !== null && raw !== undefined ? raw : "");
		}
	}

	// ── Private ───────────────────────────────────────────────────────────────

	/**
	 * Push the formula bar input value into the HOT cell.
	 */
	_commit() {
		const value = this.$formula.val();
		if (!this.board.hot) return;

		// Check readOnly
		const col_def = this.board.columns?.[this._current_col];
		if (col_def?._readonly) {
			frappe.show_alert({ message: __("This cell is read-only"), indicator: "orange" }, 2);
			return;
		}

		this.board.hot.setDataAtCell(this._current_row, this._current_col, value);
	}

	/**
	 * Restore formula bar to the current cell's saved value (cancel edit).
	 */
	_cancel() {
		this._editing = false;
		this.update(this._current_row, this._current_col);
	}

	/**
	 * Navigate HOT selection to an Excel-style address (e.g. "B3").
	 * @param {string} address - e.g. "B3", "AA10"
	 */
	_navigate_to_address(address) {
		const match = address.match(/^([A-Za-z]+)(\d+)$/);
		if (!match) return;

		const col = this._col_letters_to_index(match[1].toUpperCase());
		const row = parseInt(match[2], 10) - 1; // 1-based → 0-based

		if (row >= 0 && col >= 0) {
			this.board.hot?.selectCell(row, col);
		}
	}

	/**
	 * Convert 0-based (row, col) → Excel cell address string (e.g. "A1", "Z10", "AA1").
	 */
	_to_cell_address(row, col) {
		return this._col_index_to_letters(col) + (row + 1);
	}

	/**
	 * Convert 0-based column index → Excel column letters (A, B, ..., Z, AA, ...).
	 * @param {number} n
	 * @returns {string}
	 */
	_col_index_to_letters(n) {
		let result = "";
		n = n + 1; // 1-based
		while (n > 0) {
			const rem = (n - 1) % 26;
			result = String.fromCharCode(65 + rem) + result;
			n = Math.floor((n - 1) / 26);
		}
		return result;
	}

	/**
	 * Convert Excel column letters → 0-based column index.
	 * @param {string} letters - e.g. "A", "Z", "AA"
	 * @returns {number}
	 */
	_col_letters_to_index(letters) {
		let n = 0;
		for (let i = 0; i < letters.length; i++) {
			n = n * 26 + (letters.charCodeAt(i) - 64);
		}
		return n - 1;
	}

	/**
	 * Show/hide the formula help popup.
	 * First call creates the popup; subsequent calls toggle visibility.
	 */
	_show_formula_help() {
		if (this._$help_popup) {
			this._$help_popup.toggleClass("hide");
			return;
		}

		const sections = [
			{
				category: __("Math & Stats"),
				icon: "Σ",
				items: [
					{ formula: "=SUM(B2:B10)", desc: __("Sum of a range") },
					{ formula: "=AVERAGE(C2:C5)", desc: __("Average of values") },
					{ formula: "=MAX(D2:D10)", desc: __("Maximum value") },
					{ formula: "=MIN(D2:D10)", desc: __("Minimum value") },
					{ formula: "=COUNT(B2:B10)", desc: __("Count numeric cells") },
					{ formula: "=ROUND(A1, 2)", desc: __("Round to 2 decimals") },
					{ formula: "=ABS(A1)", desc: __("Absolute value") },
				],
			},
			{
				category: __("Logic"),
				icon: "⎇",
				items: [
					{ formula: '=IF(A1>100,"High","Low")', desc: __("Conditional value") },
					{ formula: "=AND(A1>0, B1>0)", desc: __("Both conditions true") },
					{ formula: "=OR(A1>0, B1>0)", desc: __("Either condition true") },
					{ formula: "=IFERROR(A1/B1, 0)", desc: __("Handle errors gracefully") },
					{ formula: "=NOT(A1)", desc: __("Logical NOT") },
				],
			},
			{
				category: __("Text"),
				icon: "T",
				items: [
					{ formula: '=CONCATENATE(A1," ",B1)', desc: __("Join text together") },
					{ formula: "=LEN(A1)", desc: __("Length of text") },
					{ formula: "=UPPER(A1)", desc: __("Convert to uppercase") },
					{ formula: "=LOWER(A1)", desc: __("Convert to lowercase") },
					{ formula: "=TRIM(A1)", desc: __("Remove extra spaces") },
					{ formula: "=LEFT(A1, 5)", desc: __("First 5 characters") },
				],
			},
			{
				category: __("Date & Time"),
				icon: "📅",
				items: [
					{ formula: "=TODAY()", desc: __("Today's date") },
					{ formula: "=NOW()", desc: __("Current date and time") },
					{ formula: "=YEAR(A1)", desc: __("Extract year") },
					{ formula: "=MONTH(A1)", desc: __("Extract month") },
					{ formula: "=DAY(A1)", desc: __("Extract day") },
					{ formula: '=DATEDIF(A1,B1,"D")', desc: __("Days between two dates") },
				],
			},
		];

		const grid_html = sections.map(({ category, icon, items }) => `
			<div class="ev-fh-section">
				<div class="ev-fh-category">${icon} ${category}</div>
				<div class="ev-fh-rows">
					${items.map(({ formula, desc }) => `
						<div class="ev-fh-row" title="${__("Click to insert")}">
							<code class="ev-fh-formula">${frappe.utils.escape_html(formula)}</code>
							<span class="ev-fh-desc">${desc}</span>
						</div>
					`).join("")}
				</div>
			</div>
		`).join("");

		this._$help_popup = $(`
			<div class="ev-formula-help-popup">
				<div class="ev-fh-header">
					<span class="ev-fh-title">📊 ${__("Formula Examples")}</span>
					<button class="ev-fh-close" title="${__("Close")}">×</button>
				</div>
				<div class="ev-fh-body">
					<div class="ev-fh-grid">${grid_html}</div>
					<div class="ev-fh-tip">
						↑ ${__("Click any formula to insert it. Use A1, B2 notation for cell references.")}
					</div>
				</div>
			</div>
		`).appendTo(this.wrapper);

		this._$help_popup.find(".ev-fh-close").on("click", () => {
			this._$help_popup.addClass("hide");
		});

		// Click a formula row → insert formula into formula bar input
		this._$help_popup.find(".ev-fh-row").on("click", (e) => {
			const formula = $(e.currentTarget).find(".ev-fh-formula").text();
			this.$formula.val(formula).focus();
			this._$help_popup.addClass("hide");
		});

		// Close on outside click
		$(document).on("click.ev-formula-help", (e) => {
			if (!this._$help_popup) return;
			if (!$(e.target).closest(".ev-formula-help-popup, .ev-fx-help").length) {
				this._$help_popup.addClass("hide");
			}
		});
	}

	destroy() {
		$(document).off("click.ev-formula-help");
		if (this._$help_popup) {
			this._$help_popup.remove();
			this._$help_popup = null;
		}
		$(this.wrapper).empty();
	}
};
