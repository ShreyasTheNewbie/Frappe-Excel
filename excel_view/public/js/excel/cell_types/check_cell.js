/**
 * excel_view/cell_types/check_cell.js
 *
 * HOT 6.x custom cell type for Frappe Check (boolean) fields.
 * Extends HOT's native checkbox renderer + editor but coerces
 * Frappe's 0/1 integers to true/false and back.
 */

import Handsontable from "handsontable";

frappe.provide("frappe.views.excel");

// ── Renderer ─────────────────────────────────────────────────────────────────

function checkRenderer(hotInstance, td, row, col, prop, value, cellProperties) {
	// Coerce Frappe 0/1 → boolean for HOT's checkbox renderer
	const bool_val = value === 1 || value === true || value === "1";
	arguments[5] = bool_val; // override value in arguments array
	Handsontable.renderers.CheckboxRenderer.apply(this, arguments);
	td.classList.add("ev-check-cell");
	if (cellProperties.readOnly) td.classList.add("htDimmed");
}

// ── Editor ────────────────────────────────────────────────────────────────────

class CheckEditor extends Handsontable.editors.CheckboxEditor {
	getValue() {
		// Convert boolean → Frappe's 0/1 integer
		const val = super.getValue();
		return val ? 1 : 0;
	}

	setValue(newValue) {
		// Accept 0/1 integers and booleans
		super.setValue(newValue === 1 || newValue === true || newValue === "1");
	}
}

// ── Register ──────────────────────────────────────────────────────────────────

Handsontable.renderers.registerRenderer("ev-check", checkRenderer);
Handsontable.editors.registerEditor("ev-check", CheckEditor);
Handsontable.cellTypes.registerCellType("ev-check", {
	renderer: checkRenderer,
	editor: CheckEditor,
});
