/**
 * excel_view/cell_types/date_cell.js
 *
 * HOT 6.x custom cell type for Frappe Date / Datetime fields.
 * Renders dates in the user's locale format.
 * Editor opens a native <input type="date"> for reliability.
 */

import Handsontable from "handsontable";

frappe.provide("frappe.views.excel");

// ── Renderer ─────────────────────────────────────────────────────────────────

function dateRenderer(hotInstance, td, row, col, prop, value, cellProperties) {
	Handsontable.renderers.TextRenderer.apply(this, arguments);

	if (value) {
		// Format to user locale (frappe stores dates as YYYY-MM-DD)
		try {
			const formatted = frappe.datetime.str_to_user(value);
			td.innerText = formatted || value;
		} catch {
			td.innerText = value;
		}
	}

	if (cellProperties.readOnly) td.classList.add("htDimmed");
}

// ── Editor ────────────────────────────────────────────────────────────────────

class DateEditor extends Handsontable.editors.BaseEditor {
	init() {
		this._input = document.createElement("input");
		this._input.type = "date";
		this._input.className = "ev-date-editor";
		this._input.style.cssText =
			"position:absolute;top:0;left:0;width:100%;height:100%;" +
			"border:none;padding:4px 6px;font-size:inherit;z-index:200;";

		this._input.addEventListener("change", () => this.finishEditing());
		this._input.addEventListener("keydown", (e) => {
			if (e.key === "Escape") this.finishEditing(true);
			if (e.key === "Enter") this.finishEditing();
		});
	}

	getValue() {
		// HOT / Frappe stores dates as YYYY-MM-DD — <input type=date> already gives that
		return this._input.value || "";
	}

	setValue(newValue) {
		// Accept YYYY-MM-DD or try to parse locale-formatted date
		if (!newValue) {
			this._input.value = "";
			return;
		}
		// If it's already YYYY-MM-DD, use directly
		if (/^\d{4}-\d{2}-\d{2}/.test(newValue)) {
			this._input.value = newValue.substring(0, 10);
		} else {
			// Try converting from user locale format
			try {
				const sys_date = frappe.datetime.user_to_str(newValue);
				this._input.value = sys_date ? sys_date.substring(0, 10) : "";
			} catch {
				this._input.value = "";
			}
		}
	}

	open() {
		this._cellProperties.TD.style.padding = "0";
		this._cellProperties.TD.appendChild(this._input);
		this._input.focus();
	}

	close() {
		if (this._input.parentNode) {
			this._input.parentNode.style.padding = "";
			this._input.parentNode.removeChild(this._input);
		}
	}

	prepare(row, col, prop, td, originalValue, cellProperties) {
		super.prepare(row, col, prop, td, originalValue, cellProperties);
	}
}

// ── Register ──────────────────────────────────────────────────────────────────

Handsontable.renderers.registerRenderer("ev-date", dateRenderer);
Handsontable.editors.registerEditor("ev-date", DateEditor);
Handsontable.cellTypes.registerCellType("ev-date", {
	renderer: dateRenderer,
	editor: DateEditor,
});
