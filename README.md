# Excel View for Frappe

A full spreadsheet experience built into Frappe — edit, format, and analyze any DocType data in a familiar Excel-style grid, without leaving your ERP.

Works on **vanilla Frappe** and optionally unlocks ERPNext-specific formula functions (`GL_BALANCE`, `STOCK_QTY`, `ITEM_PRICE`) when ERPNext is installed.

---

## Features

- **Spreadsheet grid** — powered by Handsontable 6.x, works with any DocType
- **Formula engine** — HyperFormula with 400+ built-in functions (SUM, IF, VLOOKUP, etc.)
- **Frappe Formula Library** — 7 ERP-native functions: `FRAPPE_GET`, `FRAPPE_SUM`, `FRAPPE_COUNT`, `FRAPPE_AVG`, `GL_BALANCE`, `STOCK_QTY`, `ITEM_PRICE`
- **Formula bar** — Excel-style formula editing with cell reference display
- **Custom cell editors** — Date picker, Link selector, Select listbox, Currency formatter, Checkbox
- **Formatting toolbar** — Bold, Italic, Underline, Strikethrough, Alignment, Wrap, Font, Size, Text color, Fill color
- **Autofill** — Drag formulas down/up with automatic relative reference adjustment
- **Context menu** — Right-click to insert/delete rows, hide/show columns, freeze columns, add formula columns
- **Find & Replace** — Ctrl+F / Ctrl+H with match-case, whole-cell options; draggable panel
- **Column Freeze** — Freeze any number of leading columns; state persisted per user
- **Status bar** — Live selection stats (Count, Sum, Average, Min, Max) in a fixed footer
- **Saved Workbooks** — Save named views with formula columns, column layout, and filters
- **Export** — Export to `.xlsx` (Excel) or `.csv`
- **Import** — Import from `.xlsx` or `.csv` with column mapping
- **Inline save** — Cell edits sync back to Frappe DB in real time

---

## Installation

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO
bench --site your-site.com install-app excel_view
```

### Updating

```bash
cd apps/excel_view && git pull
bench build --app excel_view   # required after every pull (dist files are not committed)
```

---

## Release Notes

### v2.3 — Current (Feb 2026)

**Frappe Formula Library — 7 ERP-native HyperFormula functions**
- `=FRAPPE_GET(doctype, name, fieldname)` — fetch any field from any document
- `=FRAPPE_SUM(doctype, fieldname [, filter_field, filter_val …])` — live aggregate with SUMIF-style filters
- `=FRAPPE_COUNT(doctype [, filter_field, filter_val …])` — live count
- `=FRAPPE_AVG(doctype, fieldname [, filter_field, filter_val …])` — live average
- `=GL_BALANCE(account, company [, from_date, to_date, cost_center, finance_book])` — net GL balance (ERPNext only)
- `=STOCK_QTY(item_code, warehouse [, as_of_date])` — current or point-in-time stock qty (ERPNext only)
- `=ITEM_PRICE(item_code, price_list [, qty, customer, uom])` — live price list lookup (ERPNext only)
- Async two-pass cache: cells show `#LOADING…` shimmer while fetching, then auto-update
- GPU-composited shimmer animation (`transform` on `::after`, `will-change: transform`)
- Permission enforcement: `#PERM_DENIED` on access denied; `#ERR!` on server error
- Dynamic field validation — respects custom fields from any installed app
- ERPNext functions conditionally registered — gracefully absent on vanilla Frappe

**Bug fixes**
- Field picker — selecting new columns now triggers a fresh server fetch; data no longer shows blank for newly added columns
- "Unsaved changes" indicator no longer appears falsely after dragging a formula column (only fires when a DB-backed field is actually modified)

---

### v2.2 — Feb 2026

**Column Freeze**
- Right-click any column header → "Freeze up to this column"
- Unfreeze via right-click → "Unfreeze All Columns"
- Visual indicator: soft shadow border on freeze boundary
- Freeze position saved in `user_settings` — restored automatically on next load

**Find & Replace**
- Ctrl+F → Find panel; Ctrl+H → Find & Replace panel
- Options: Match case, Whole cell only
- Navigation: Enter / Shift+Enter cycles through all matches (count badge shown)
- Replace One / Replace All — readonly cells skipped automatically
- Draggable floating panel

**Status Bar**
- Fixed footer showing live selection stats: address, Count, Sum, Average, Min, Max
- Performance guard: skips numeric scan for selections > 5,000 cells
- Correctly handles formula cells (uses HyperFormula evaluated result)
- Strict numeric detection — date strings like `"2026-02-22"` are not counted as numbers

---

### v2.1 — Feb 2026

**Saved Workbooks**
- Save named workbooks per DocType: column selection, order, widths, formula columns, filters, sort
- Load/switch workbooks from toolbar "Views" dropdown
- "Save View" split-button: overwrite current or save as new ("Save As…")
- My Views / Shared Views sections; delete with confirmation
- Workbook state auto-restored on page refresh (server-side via `Excel Workbook` DocType)

**Formula Columns**
- Add virtual columns not tied to any Frappe field
- Supports formulas (`=SUM`, `=IF`, Frappe functions, etc.) and plain values
- Saved and restored as part of workbook (per-doc values keyed by `doc.name`)
- Autofill works with relative reference adjustment

---

### v2.0 — Feb 2026

**Performance**
- Lazy loading — 4KB router bundle loads everywhere; 1.6MB deps bundle loads only when Excel View is opened
- Zero cost for users who never open Excel View

**Field Picker — "Choose Columns" dialog**
- Select which DocType fields to display; drag-to-reorder; saved server-side per user
- RBAC-aware — respects `permlevel` field permissions
- Live search by label or fieldname; Select All / Deselect All

**Toolbar & Grid**
- Full formatting toolbar wired for single cell and multi-cell range selection
- Rich color palette: 3-section Excel 2007 style (theme + standard + recent + custom hex)
- `outsideClickDeselects: false` — toolbar clicks don't deselect the grid
- Column widths persist per user per DocType

---

### v1.0 — Initial Release

- Full spreadsheet grid for any DocType
- HyperFormula integration (400+ formulas), formula bar, autofill
- Custom cell editors: Date, Link, Select, Currency, Check
- Formatting toolbar: font, size, bold/italic/underline/strike, alignment, wrap, text/fill color
- Context menu (insert/delete rows)
- Export to `.xlsx` / `.csv`, Import from `.xlsx` / `.csv`
- Inline real-time save to Frappe DB
- View switcher integration (alongside List, Kanban, Report views)

---

## Upcoming

### v2.4 — IntelliLookup

3-layer ML-assisted VLOOKUP between loaded data sets:
- **Layer 1** — Frappe meta Link field detection (instant, schema-based)
- **Layer 2** — Data existence sampling (70% overlap confirms join key)
- **Layer 3** — Manual VLOOKUP builder (user-configured fallback)

Client-side join on loaded arrays — no formula writing required. Works entirely without LLMs (scikit-learn + rapidfuzz).

### v2.5 — Multi-Sheet Workbooks + QUERY()

- Sheet tab bar at bottom (Excel / Google Sheets style)
- Each tab = independent DocType query
- HyperFormula multi-sheet support (cross-sheet refs: `Sheet2!A1`)
- `=QUERY(doctype, fields, filters)` — pull any DocType data into a sheet; results spill into a dedicated tab
- Workbook save/load includes all sheet state

### v3.0+

- Cross-sheet formulas, charts, pivot tables, conditional formatting, dashboard mode
- Smart Autofill — RandomForest predicts values per field per DocType
- Stock Reorder Predictor — days-to-reorder + suggested qty column (LinearReg + IsolationForest)
- Impact Simulator — bi-directional change tracing across linked documents

---

## Tech Stack

| Layer | Library |
|---|---|
| Grid | [Handsontable](https://handsontable.com/) 6.2.2 (Community, GPL-3.0) |
| Formula engine | [HyperFormula](https://hyperformula.handsontable.com/) 2.x (GPL-3.0) |
| Excel export/import | [ExcelJS](https://github.com/exceljs/exceljs) (lazy-loaded) |
| CSV parsing | [PapaParse](https://www.papaparse.com/) |
| ML (upcoming) | scikit-learn, rapidfuzz, networkx, joblib |

---

## Contributing

```bash
cd apps/excel_view
pre-commit install
bench build --app excel_view --watch
```

PRs welcome. No LLM-based features — all AI/ML uses only open-source classical libraries (scikit-learn, rapidfuzz, networkx).

---

## License

MIT
