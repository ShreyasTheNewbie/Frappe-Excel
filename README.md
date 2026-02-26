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
- **IntelliFlow Join Canvas** — Visual multi-DocType join builder; drag-and-drop nodes, SVG bezier wires, grade badges (S/A/B/C/D/F), cardinality + coverage stats; canvas state persisted per user
- **AI Join Suggestions** — networkx graph + TF-IDF + RapidFuzz surface related DocTypes automatically; right-side drawer with per-node ✨ targeting and live search
- **Join Path Finder** — BFS shortest path through schema graph; auto-builds multi-hop node chains in one click
- **4-Layer Validation Engine** — Meta Guard → Pattern Matcher → Type Gate (hard incompatibility → instant red wire) → Value Overlap → Semantic (RapidFuzz); works entirely without LLMs
- **Association Rule Mining** — mlxtend Apriori on joined data surfaces co-occurrence patterns (IF customer=X THEN territory=Y, lift ≥ 1.2)

---

## Installation

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO
bench --site your-site.com install-app excel_view
```

Python ML dependencies (networkx, scikit-learn, mlxtend, rapidfuzz, etc.) are listed in `pyproject.toml` and installed automatically by pip when the app is installed. If for any reason they are missing:

```bash
bench pip install -r apps/excel_view/requirements.txt
```

### Updating

```bash
cd apps/excel_view && git pull
bench build --app excel_view   # required after every pull (dist files are not committed)
```

---

## Release Notes

### v2.4.5 — Current (Feb 2026)

**IntelliFlow AI — 4-Layer Validation + AI Discovery**

- **4-Layer validation pipeline:** L0 Meta Guard → L1 Pattern Matcher → L2 Type Gate → L3 Value Overlap → L4 Semantic
  - L1 detects `naming_series` / `hash` / `email` / `date` / `numeric` / `text` patterns per field
  - L2 is a hard gate — type-incompatible pairs (date ↔ numeric, email ↔ hash, etc.) reject immediately; wire turns **red** with no delay
  - L3 value overlap combined with L1 pattern score (composite = max of both)
  - L4 RapidFuzz `token_sort_ratio` + `partial_ratio` + dynamic `std_fields` boost
  - Final confidence = 0.7 × composite + 0.3 × semantic
  - Grades: **S** (meta link) / **A** (≥0.80) / **B** (≥0.60) / **C** (≥0.40) / **D** (≥0.25) / **F** (rejected)
- **`✨ AI` Suggestions drawer** — right-side panel (slides in), cards with left color stripe (green = direct Link, blue = ML), score bar, + Add button, live search filter
  - Per-node targeting: click ✨ on any canvas node to get suggestions for that DocType
  - ↻ Refresh button to bust the 5-min Redis cache on demand
  - Returns ALL candidates (no top-5 cap) — direct Link DocTypes first, then ML-ranked
- **`🔗 Path` finder** — `frappe.prompt` → BFS via networkx on cached schema graph → auto-builds multi-hop node chain
- **`📊 Patterns`** — mlxtend Apriori on applied join data; IF/THEN table with support, confidence, lift (lift ≥ 2 highlighted green)
- **Port glow during wire drag** — `rank_field_matches` (TF-IDF + rapidfuzz) scores target ports; high-score ports pulse green, mid-score amber
- **Badge enrichment** — grade chip + `1:N | 87% cov` appended to each edge label
- **Performance** — single SQL JOIN on `tabDocField` + `UNION` Custom Fields + 5-min Redis cache replaces N×`get_meta()` calls; `istable=0 + issingle=0` filters exclude child/single DocTypes

---

### v2.4 — Feb 2026

**IntelliFlow — Visual Join Canvas**

- Full-screen overlay canvas with draggable DocType nodes and SVG bezier wire edges
- `+ Add DocType` button → searchable node added to canvas
- Draw wires from right-side output ports to left-side input ports to create joins
- 2-layer validation: meta Link field check → data value overlap sampling (≥30% = valid)
- Valid edge: green solid wire + confidence badge; Invalid: red dashed + auto-remove after 3s
- Field checkboxes on target nodes to select which columns to include in output
- **Preview** (5 rows) + **Apply** → `get_joined_data` → dynamic LEFT JOIN SQL → virtual join columns in grid (read-only, excluded from DB saves)
- **Canvas persistence** — state (nodes, positions, edges, field selections) saved in `user_settings` and inside Workbook DocType; auto-restored and re-validated on next open

---

### v2.3 — Feb 2026

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

### v2.5 — Multi-Sheet Workbooks + QUERY()

- Sheet tab bar at bottom (Excel / Google Sheets style)
- Each tab = independent DocType query with its own field picker, filters, and sort
- HyperFormula multi-sheet registration (cross-sheet refs prep for V3.0)
- `=QUERY(doctype, fields, filters)` — pull any DocType data into a sheet; results spill into a dedicated tab
- Workbook save/load includes all sheet state (lazy fetch — only active tab loads on open)
- IntelliLookup column auto-detected between related sheets (3-layer: meta Link → sampling → manual builder)

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
| ML | networkx, scikit-learn, rapidfuzz, mlxtend, scipy, pandas (all open-source, no LLMs) |

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
