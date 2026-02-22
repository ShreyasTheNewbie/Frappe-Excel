/**
 * excel_view/cell_types/link_cell.js
 *
 * HOT 6.x custom cell type for Frappe Link fields.
 * Renders as a clickable link, edits via an autocomplete dropdown
 * that queries frappe.db.get_list for matching documents.
 */

import Handsontable from "handsontable";

frappe.provide("frappe.views.excel");

// ── Renderer ─────────────────────────────────────────────────────────────────

function linkRenderer(hotInstance, td, row, col, prop, value, cellProperties) {
	// Base text rendering first
	Handsontable.renderers.TextRenderer.apply(this, arguments);

	if (!value) return;

	// Wrap value in a clickable anchor
	const link_doctype = cellProperties._df?.options || cellProperties._link_doctype;
	if (link_doctype) {
		const slug = frappe.router.slug(link_doctype);
		const href = `/app/${slug}/${encodeURIComponent(value)}`;
		td.innerHTML = `<a href="${href}" onclick="event.stopPropagation()"
			class="ev-link-cell" title="${__("Open {0}", [value])}">${value}</a>`;
	}

	if (cellProperties.readOnly) {
		td.classList.add("htDimmed");
	}
}

// ── Editor ────────────────────────────────────────────────────────────────────

class LinkEditor extends Handsontable.editors.TextEditor {
	constructor(hotInstance) {
		super(hotInstance);
		this._suggestions = [];
		this._dropdown = null;
		this._search_timeout = null;
	}

	prepare(row, col, prop, td, originalValue, cellProperties) {
		super.prepare(row, col, prop, td, originalValue, cellProperties);
		this._link_doctype = cellProperties._df?.options || cellProperties._link_doctype;
	}

	beginEditing(initialValue, event) {
		super.beginEditing(initialValue, event);
		this._setup_dropdown();
		// Fetch immediately: use typed char (initialValue) → existing value → "" (show top 10)
		const query = initialValue ?? this.originalValue ?? "";
		this._fetch_suggestions(String(query));
	}

	_setup_dropdown() {
		this._remove_dropdown();
		this._dropdown = document.createElement("div");
		this._dropdown.className = "ev-link-dropdown";
		document.body.appendChild(this._dropdown);
		this._position_dropdown();

		// Search on input
		this.TEXTAREA.addEventListener("input", () => {
			clearTimeout(this._search_timeout);
			this._search_timeout = setTimeout(() => {
				this._fetch_suggestions(this.TEXTAREA.value);
			}, 300);
		});
	}

	_fetch_suggestions(query) {
		if (!this._link_doctype) {
			this._clear_dropdown();
			return;
		}

		// Empty query → fetch top 10 to show available options immediately
		const filters = query
			? [["name", "like", `%${query}%`]]
			: [];

		frappe.db
			.get_list(this._link_doctype, {
				filters,
				fields: ["name"],
				limit: 10,
			})
			.then((results) => {
				this._suggestions = results.map((r) => r.name);
				this._render_dropdown();
			})
			.catch(() => {
				this._clear_dropdown();
			});
	}

	_render_dropdown() {
		if (!this._dropdown) return;
		this._position_dropdown();

		if (!this._suggestions.length) {
			this._dropdown.innerHTML = `<div class="ev-link-no-results">${__("No results")}</div>`;
			return;
		}

		this._dropdown.innerHTML = this._suggestions
			.map(
				(name) =>
					`<div class="ev-link-option" data-value="${frappe.utils.escape_html(name)}">${frappe.utils.escape_html(name)}</div>`
			)
			.join("");

		// Click to select
		this._dropdown.querySelectorAll(".ev-link-option").forEach((el) => {
			el.addEventListener("mousedown", (e) => {
				e.preventDefault();
				this.setValue(el.dataset.value);
				this.finishEditing();
			});
		});
	}

	_clear_dropdown() {
		if (this._dropdown) this._dropdown.innerHTML = "";
	}

	_remove_dropdown() {
		if (this._dropdown) {
			this._dropdown.remove();
			this._dropdown = null;
		}
	}

	_position_dropdown() {
		if (!this._dropdown || !this.TEXTAREA) return;
		const rect = this.TEXTAREA.getBoundingClientRect();
		Object.assign(this._dropdown.style, {
			position: "fixed",
			top: rect.bottom + "px",
			left: rect.left + "px",
			width: Math.max(200, rect.width) + "px",
			zIndex: 9999,
		});
	}

	finishEditing(isCancelled, ctrlDown, callback) {
		this._remove_dropdown();
		clearTimeout(this._search_timeout);
		super.finishEditing(isCancelled, ctrlDown, callback);
	}

	close() {
		this._remove_dropdown();
		super.close();
	}
}

// ── Register ──────────────────────────────────────────────────────────────────

Handsontable.renderers.registerRenderer("ev-link", linkRenderer);
Handsontable.editors.registerEditor("ev-link", LinkEditor);
Handsontable.cellTypes.registerCellType("ev-link", {
	renderer: linkRenderer,
	editor: LinkEditor,
});
