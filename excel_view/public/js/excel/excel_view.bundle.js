/**
 * excel_view/excel_view.bundle.js
 *
 * Heavy deps bundle (~1.4MB).
 * NOT listed in hooks.py app_include_js.
 * Dynamically imported by excel_view_router.bundle.js when Excel View is
 * first opened by the user.
 *
 * This bundle:
 *   1. Imports HOT, HyperFormula, PapaParse, Pickr, numfmt
 *   2. Registers all custom cell types with Handsontable
 *   3. Defines all components (ExcelBoard, FormulaBar, Toolbar, etc.)
 *   4. Injects Handsontable CSS
 *
 * Monkey-patches and ExcelView class live in excel_view_router.bundle.js
 * (the tiny bundle that loads everywhere) — NOT here.
 *
 * NOTE: ExcelJS uses async generators (ES2018) which Frappe's esbuild target
 * (es2017) cannot transform. ExcelJS is lazy-loaded at runtime in export_manager.js.
 */

// ── 1. npm dependencies ───────────────────────────────────────────────────────

import Handsontable from "handsontable";
import { HyperFormula } from "hyperformula";
import Papa from "papaparse";
import Pickr from "@simonwep/pickr";
// numfmt v3.x uses named ESM exports — import the `format` function
import { format as numfmt_format } from "numfmt";

// Expose globally — sub-modules reference these via window.*
window.Handsontable = Handsontable;
window.HyperFormula = HyperFormula;
window.Papa = Papa;
window.Pickr = Pickr;
// Expose as window.numfmt(pattern, value) for currency_cell.js
window.numfmt = numfmt_format;

// ── 1b. Inject Handsontable CSS ────────────────────────────────────────────────
// Frappe's SCSS pipeline can't resolve ~package imports from a custom app's
// node_modules. Bench symlinks node_modules → /assets/excel_view/node_modules/
// so we inject the link tag at runtime instead.

if (!document.getElementById("ev-hot-css")) {
	const link = document.createElement("link");
	link.id = "ev-hot-css";
	link.rel = "stylesheet";
	link.href = "/assets/excel_view/node_modules/handsontable/dist/handsontable.full.css";
	document.head.appendChild(link);
}

// ── 2. Utilities ──────────────────────────────────────────────────────────────

import "./utils/field_type_map.js";
// V2.3: frappe_formula_plugin MUST be imported before formula_bridge.
// registerFunctionPlugin() runs at module-eval time; HyperFormula.buildEmpty()
// runs later at runtime — plugins registered before buildEmpty are picked up.
import "./utils/frappe_formula_plugin.js";
import "./utils/formula_bridge.js";
import "./utils/export_manager.js";

// ── 3. Custom cell types ──────────────────────────────────────────────────────
// Must be imported BEFORE any component that references Handsontable.cellTypes.*

import "./cell_types/index.js";

// ── 4. Components ─────────────────────────────────────────────────────────────

import "./components/context_menu.js";
import "./components/data_manager.js";
import "./components/column_manager.js";
import "./components/formula_bar.js";
import "./components/toolbar.js";
import "./components/field_picker.js";
import "./components/workbook_manager.js";  // V2.1 — Saved Workbooks
import "./components/status_bar.js";        // V2.2 — Status Bar
import "./components/join_canvas.js";       // V2.4 — IntelliFlow Join Canvas
import "./components/sheet_manager.js";    // V2.5 — Multi-Sheet Workbooks
import "./components/excel_board.js";

// ── 5. Signal that deps are ready ─────────────────────────────────────────────
// The router bundle's _load_deps() promise resolves on <script> onload,
// which fires after this module executes. Nothing extra needed here.
// ExcelBoard is now available as frappe.views.ExcelBoard — the ExcelView
// instance's _render_board() call will find it.
