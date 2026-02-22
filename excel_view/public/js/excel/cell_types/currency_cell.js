/**
 * excel_view/cell_types/currency_cell.js
 *
 * HOT 6.x custom cell type for Frappe Currency and Float fields.
 * Uses `numfmt` to render values in the system currency format.
 * Editor is a plain numeric input; value is stored as a raw number.
 */

import Handsontable from "handsontable";
import { format as numfmt } from "numfmt";

frappe.provide("frappe.views.excel");

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Get the numfmt format string for the system default currency.
 * Falls back to plain two-decimal if frappe.boot is unavailable.
 */
function _get_currency_format() {
	const symbol = frappe.boot?.sysdefaults?.currency_symbol || "$";
	const precision = cint(frappe.boot?.sysdefaults?.currency_precision) || 2;
	const zeros = "0".repeat(precision);
	return `"${symbol}"#,##0.${zeros}`;
}

// ── Renderer ─────────────────────────────────────────────────────────────────

function currencyRenderer(hotInstance, td, row, col, prop, value, cellProperties) {
	Handsontable.renderers.TextRenderer.apply(this, arguments);

	if (value !== null && value !== undefined && value !== "") {
		const num = parseFloat(value);
		if (!isNaN(num)) {
			try {
				const fmt = _get_currency_format();
				td.innerText = numfmt(fmt, num);
				td.classList.add("htNumeric", "ev-currency-cell");
				td.style.textAlign = "right";
			} catch {
				td.innerText = frappe.format(num, { fieldtype: "Currency" });
			}
		}
	}

	if (cellProperties.readOnly) td.classList.add("htDimmed");
}

// ── Editor ────────────────────────────────────────────────────────────────────

class CurrencyEditor extends Handsontable.editors.TextEditor {
	prepare(row, col, prop, td, originalValue, cellProperties) {
		super.prepare(row, col, prop, td, originalValue, cellProperties);
	}

	beginEditing(initialValue, event) {
		// Show raw numeric value (not formatted) in editor
		const raw = this.originalValue;
		super.beginEditing(raw !== null && raw !== undefined ? String(raw) : "", event);
		if (this.TEXTAREA) {
			this.TEXTAREA.type = "number";
			this.TEXTAREA.step = "any";
			this.TEXTAREA.style.textAlign = "right";
		}
	}

	getValue() {
		const val = super.getValue();
		const num = parseFloat(val);
		return isNaN(num) ? "" : num;
	}
}

// ── Register ──────────────────────────────────────────────────────────────────

Handsontable.renderers.registerRenderer("ev-currency", currencyRenderer);
Handsontable.editors.registerEditor("ev-currency", CurrencyEditor);
Handsontable.cellTypes.registerCellType("ev-currency", {
	renderer: currencyRenderer,
	editor: CurrencyEditor,
});
