/**
 * excel_view/components/status_bar.js
 *
 * Excel-style status bar — fixed footer below the grid.
 * Shows live stats for the current cell selection:
 *
 *   [ A1:C5 ]  |  Count: 15   Sum: 1,24,820   Average: 8,321   Min: 399   Max: 39,900
 *
 * Values are read directly from HOT; formula cells use HyperFormula evaluated results.
 * Performance guard: skips numeric scan for selections > MAX_SCAN_CELLS.
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.StatusBar = class StatusBar {
	// Skip expensive cell scan for selections larger than this
	static MAX_SCAN_CELLS = 5000;

	/**
	 * @param {Object}  opts
	 * @param {Object}  opts.board   - ExcelBoard instance
	 * @param {Element} opts.wrapper - DOM container to render into
	 */
	constructor({ board, wrapper }) {
		this.board = board;
		this.wrapper = wrapper;
		this._render();
	}

	// ── Setup ─────────────────────────────────────────────────────────────────

	_render() {
		$(this.wrapper).html(`
			<div class="ev-status-bar">
				<span class="ev-sb-address"></span>
				<span class="ev-sb-sep"></span>
				<span class="ev-sb-stats"></span>
			</div>
		`);
		this.$bar   = $(this.wrapper).find(".ev-status-bar");
		this.$addr  = this.$bar.find(".ev-sb-address");
		this.$stats = this.$bar.find(".ev-sb-stats");
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Recompute and display stats for the selection bounded by [r1,c1]→[r2,c2].
	 * Called by ExcelBoard._on_selection after every HOT afterSelection event.
	 *
	 * @param {number} r1 - selection start row (may be > r2 for reverse selections)
	 * @param {number} c1 - selection start col
	 * @param {number} r2 - selection end row
	 * @param {number} c2 - selection end col
	 */
	update(r1, c1, r2, c2) {
		// Normalize to top-left / bottom-right
		const row1 = Math.min(r1, r2 ?? r1);
		const row2 = Math.max(r1, r2 ?? r1);
		const col1 = Math.min(c1, c2 ?? c1);
		const col2 = Math.max(c1, c2 ?? c1);

		// ── Address box ─────────────────────────────────────────────────────
		const a1 = this._addr(row1, col1);
		const a2 = this._addr(row2, col2);
		const is_single = row1 === row2 && col1 === col2;
		this.$addr.text(is_single ? a1 : `${a1}:${a2}`);

		// ── Stats ────────────────────────────────────────────────────────────
		const cell_count = (row2 - row1 + 1) * (col2 - col1 + 1);

		// Performance guard — too many cells, just show count
		if (cell_count > StatusBar.MAX_SCAN_CELLS) {
			this.$stats.html(this._pill(__("Count"), this._fmt(cell_count)));
			return;
		}

		// Scan all selected cells for numeric values
		const nums = [];
		let non_empty = 0;

		for (let r = row1; r <= row2; r++) {
			for (let c = col1; c <= col2; c++) {
				let val = this.board.hot.getDataAtCell(r, c);

				// For formula cells use HyperFormula's evaluated result
				if (this.board.formula_bridge?.is_formula(val)) {
					val = this.board.formula_bridge.get_display_value(r, c);
				}

				if (val !== null && val !== undefined && val !== "") {
					non_empty++;
					// Only treat as numeric if the raw value is already a JS number,
					// or if the string is a pure number (no letters/dashes).
					// Prevents date strings like "2026-02-22 09:55:55" being parsed
					// as 2026 via parseFloat, which creates bogus Sum/Average.
					let n;
					if (typeof val === "number") {
						n = val;
					} else {
						const s = String(val).trim();
						n = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s) ? parseFloat(s) : NaN;
					}
					if (!isNaN(n)) nums.push(n);
				}
			}
		}

		// Build stat pills
		const parts = [];

		// Count — only shown for multi-cell selections
		if (!is_single) {
			parts.push(this._pill(__("Count"), this._fmt(non_empty)));
		}

		if (nums.length > 0) {
			const sum = nums.reduce((a, b) => a + b, 0);
			parts.push(this._pill(__("Sum"), this._fmt(sum)));

			if (nums.length > 1) {
				const avg = sum / nums.length;
				const min = Math.min(...nums);
				const max = Math.max(...nums);
				parts.push(this._pill(__("Average"), this._fmt(avg)));
				parts.push(this._pill(__("Min"), this._fmt(min)));
				parts.push(this._pill(__("Max"), this._fmt(max)));
			}
		}

		this.$stats.html(
			parts.join('<span class="ev-sb-divider">|</span>')
		);
	}

	/**
	 * Clear the status bar (called when grid loses focus or is destroyed).
	 */
	clear() {
		this.$addr.text("");
		this.$stats.html("");
	}

	destroy() {
		$(this.wrapper).empty();
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	/** Build a labelled stat pill: "Sum: 1,24,820" */
	_pill(label, value) {
		return `<span class="ev-sb-stat"><span class="ev-sb-label">${label}:</span> ${value}</span>`;
	}

	/**
	 * Format a number for display.
	 * Integers → no decimals; floats → up to 2 decimal places.
	 * Uses native toLocaleString — works in all browsers, respects system locale.
	 */
	_fmt(n) {
		const is_int = Math.abs(n - Math.round(n)) < 1e-9;
		return n.toLocaleString(undefined, {
			minimumFractionDigits: 0,
			maximumFractionDigits: is_int ? 0 : 2,
		});
	}

	/** Convert 0-based [row, col] → Excel cell address (e.g. 0,0 → "A1") */
	_addr(row, col) {
		return `${this._col_letter(col)}${row + 1}`;
	}

	/** Convert 0-based column index → Excel column letter(s): 0→A, 25→Z, 26→AA */
	_col_letter(n) {
		let result = "";
		n++;
		while (n > 0) {
			const rem = (n - 1) % 26;
			result = String.fromCharCode(65 + rem) + result;
			n = Math.floor((n - 1) / 26);
		}
		return result;
	}
};
