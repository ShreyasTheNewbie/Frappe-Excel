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
- **Saved Workbooks** — Save named views with formula columns, column layout, filters, join config, and sheet tabs
- **Multi-Sheet Workbooks** — Multiple DocType tabs in one workbook; each tab is an independent query with its own fields, filters, and sort
- **Export** — Export to `.xlsx` (Excel) or `.csv`
- **Import** — Import from `.xlsx` or `.csv` with column mapping
- **Inline save** — Cell edits sync back to Frappe DB in real time
- **IntelliFlow Join Canvas** — Visual multi-DocType join builder; drag-and-drop nodes, SVG bezier wires, grade badges (S/A/B/C/D/F), cardinality + coverage stats; canvas auto-saved on every structural change
- **Child Table Support** — Child-table DocTypes (e.g. `Timesheet Detail`, `Sales Invoice Item`) can be added as canvas nodes; teal `CT` badge distinguishes them; system fields (`parent`, `parenttype`, `parentfield`, `idx`) auto-filtered
- **Aggregate Mode** — CT nodes replace field checkboxes with a `📊 Aggregate` panel: choose field + function (SUM/COUNT/AVG/MIN/MAX) per column; generates a `GROUP BY` subquery so you always get 1 row per parent record (no fan-out)
- **Per-Node Transform Panel** — Non-CT nodes get a collapsible `🔧 Transform` section: Row Filters (=, !=, >, <, >=, <=, like, in) evaluated server-side, and Computed Columns (Python expressions via `frappe.safe_eval`)
- **AI Join Suggestions** — networkx graph + TF-IDF + RapidFuzz surface related DocTypes automatically; right-side drawer with per-node ✨ targeting, live search, and teal CT stripe for child-table suggestions
- **AI Analysis Panel** — post-Apply `🤖 Analyze` button opens right-side drawer: Anomaly Detection (IsolationForest) and Clustering (MiniBatchKMeans with silhouette auto-k); results injected as `_anomaly_score`/`_cluster` columns with row highlighting
- **Join Path Finder** — BFS shortest path through schema graph; auto-builds multi-hop node chains in one click
- **4-Layer Validation Engine** — Meta Guard → Pattern Matcher → Type Gate (hard incompatibility → instant red wire) → Value Overlap → Semantic (RapidFuzz); works entirely without LLMs
- **Association Rule Mining** — mlxtend Apriori on joined data surfaces co-occurrence patterns (IF customer=X THEN territory=Y, lift ≥ 1.2)
- **Generative BI Chat** — Natural language join discovery: "show me tasks to employee" with enhanced NLP (50+ stopwords, pattern matching, fuzzy DocType matching); clean modern UI with staggered card animations and smooth hover expansion

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

### v2.7 — Current (Mar 2026)

**GenBI AI Conversational Bot — Multi-Turn Intelligence**

- **AI Conversational Engine** — Complete rewrite from fuzzy-only to full NLP stack with multi-turn conversation memory
  - **6 Intent Classification** — FIND_PATH, EXPLAIN, BUILD_CANVAS, SUGGEST, ANALYZE_DATA, REFINE using sentence-transformers semantic matching (all-MiniLM-L6-v2)
  - **3-Phase Entity Resolution** — Pronoun resolution → Exact match → Fuzzy (60%) + Semantic (40%) composite scoring with spaCy + embeddings
  - **Conversation State** — Redis-backed session memory (1-hour TTL); tracks last entities, paths, canvas state, follow-up mode
  - **Relationship Explanations** — Generates human-readable explanations with business context ("Sales funnel: tracking leads through conversion to orders"), Link field direction (1:1, 1:N, N:M), confidence reasoning
  - **Data Insights** — Row counts, empty table warnings, cardinality analysis (1:N explosion detection), filter suggestions per DocType
  - **Query Parser** — Complex query parsing using spaCy dependency parsing for auto-canvas building ("employee salary with deductions grouped by department")
- **Enhanced UI** — Follow-up suggestion pills (interactive chips for next queries), disambiguation buttons when multiple entities match, explanation bubbles with expandable sections, data availability badges (✓ Has data / ⚠ Empty tables)
- **Smart Context** — "Build this canvas" uses last explained path from conversation; pronoun resolution ("explain it" → resolves "it" from context); showing "top 10 of 200 paths" instead of overwhelming users
- **Production Ready** — Auto-installs via requirements.txt (spaCy model as direct wheel URL); Frappe Cloud/Docker compatible; ~92 MB models cached after first install; no external API keys needed
- **New Backend Modules** — 7 modules in `excel_view/genbi/`: conversation.py, intent_classifier.py, entity_resolver.py, explainer.py, query_parser.py, data_insights.py, __init__.py
- **New API Endpoint** — `genbi_chat(query, session_id, base_doctype)` replaces simple fuzzy search with full conversational AI
- **Dependencies Added** — spacy>=3.7, sentence-transformers>=2.2, en_core_web_sm model (auto-installed)
- **Files modified:** [api.py](excel_view/api.py), [join_canvas.js](excel_view/public/js/excel/components/join_canvas.js), [excel_view.bundle.scss](excel_view/public/scss/excel_view.bundle.scss), [requirements.txt](requirements.txt), [pyproject.toml](pyproject.toml)

---

### v2.6 — Feb 2026

**Generative BI UX Polish + Enhanced NLP**

- **Modern Chat UI** — Redesigned Generative BI results with clean cards (removed 3x data redundancy), confidence badges, hop counts, and estimated field counts; no more verbose badge clutter
- **Staggered Animation** — Sequential card loading with 80ms stagger delay for smooth visual feedback (400ms ease transition per card)
- **Hover Expansion** — Card titles smoothly expand from single-line to multi-line on hover (cubic-bezier animation) instead of static tooltips
- **Enhanced NLP** — Query parser expanded from 13 to 50+ stopwords; supports natural phrasing ("show me tasks to employee", "connect employee with their tasks") with pattern matching regex; improved multi-word DocType fuzzy matching (rapidfuzz token_sort_ratio)
- **Files modified:** [join_canvas.js](excel_view/public/js/excel/components/join_canvas.js), [api.py](excel_view/api.py), [excel_view.bundle.scss](excel_view/public/scss/excel_view.bundle.scss)

---

### v2.5+ — Feb 2026

**Child Table Support + Aggregate Mode in IntelliFlow Canvas**

- **Child table nodes** — DocTypes with `istable=1` (e.g. `Timesheet Detail`, `Sales Invoice Item`, `Purchase Order Item`) can now be added to the canvas. AI Suggestions automatically surfaces them with a teal `CT` badge and stripe.
- **Aggregate panel** — CT nodes show a `📊 Aggregate` builder instead of field checkboxes. Add any number of `[field] [SUM/COUNT/AVG/MIN/MAX]` rows. The SQL engine generates a `GROUP BY` subquery — no fan-out, always 1 row per parent record.
  ```sql
  -- Example: Task → Timesheet Detail (SUM hours)
  LEFT JOIN (
      SELECT task, SUM(hours) AS `Timesheet Detail__hours`
      FROM `tabTimesheet Detail`
      GROUP BY task
  ) t1 ON t0.name = t1.task
  ```
- **Schema graph updated** — `_get_all_link_edges()` no longer filters out `istable=1` sources; adds `is_child_src` flag; `suggest_joins()` uses `method: "child_table"` for these; sort order: meta → child_table → ML. Cache key bumped to `v2`.
- **1:N fan-out fix** — `_apply_join_result()` in `excel_board.js` now detects when `joined_rows` has multiple entries per base record (1:N regular join) and expands `list_view.data` by cloning base rows — preserving all data instead of overwriting with the last row.
- **Canvas auto-save layout** — Canvas state now persists on every structural change (valid edge created, node removed, node dragged), not only after Apply. Removing all non-base nodes explicitly clears `user_settings` so refresh starts clean.

---

### v2.5 — Feb 2026

**Multi-Sheet Workbooks + Transform Panel + AI Analysis**

**Sheet Tabs**
- Tab strip at bottom of grid (Excel / Google Sheets style)
- Each tab = independent DocType query with its own field picker, filters, sort, and column widths
- `+` button → DocType picker dialog; double-click to rename; `×` to remove (Sheet 1 locked)
- HyperFormula multi-sheet registration (`hf.addSheet` per tab); active sheet tracked via `formula_bridge.set_active_sheet()`
- HOT swap on tab switch: `hot.updateSettings({ columns })` + `hot.loadData(data)` — instant, no re-fetch if data cached
- Lazy fetch — only the active tab loads data on open
- Workbook save/load includes full `sheets[]` state (`Excel Workbook.sheets` Code/JSON field)

**IntelliLookup Banner**
- After adding a second sheet tab, a non-intrusive banner auto-detects if the new DocType links to the current one (meta L1A/L1B + value sampling L2)
- "Add lookup column →" injects a client-side join column without any formula

**Per-Node Transform Panel (`🔧 Transform`)**
- Collapsible panel on every non-CT, non-base canvas node
- **Row Filters**: `[field] [=|!=|>|<|>=|<=|like|in] [value]` evaluated server-side in `_apply_node_transforms()`; `like` and `in` operators handled specially; numeric and string comparisons auto-detected
- **Computed Columns**: `label` + Python expression evaluated via `frappe.safe_eval` with `row` context; safe builtins only; errors → `#ERR!`
- State serialized into `join_config.nodes[].row_filter` and `computed_cols`; restored from workbook/user_settings

**AI Analysis Panel (`🤖 Analyze`)**
- Button appears in canvas header after Apply
- Right-side drawer with two tabs:
  - **Anomaly Detection** — scikit-learn `IsolationForest`; contamination slider (5–30%); injects `_anomaly_score` + `_is_anomaly` per row; anomalous rows highlighted red in grid
  - **Clustering** — `MiniBatchKMeans`; K=Auto (silhouette) or manual 2–6; injects `_cluster` column; rows colored by cluster (6 pastel colors); centroid summary dialog
- Results injected into `board.list_view.data` in-place; `board.hot.render()` picks up row coloring via extended `cells` callback

**New API endpoints**: `detect_lookup`, `detect_anomalies`, `cluster_data`, `_apply_node_transforms`

---

### v2.4.5 — Feb 2026

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
- **Performance** — single SQL JOIN on `tabDocField` + `UNION` Custom Fields + 5-min Redis cache replaces N×`get_meta()` calls

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

---

### v2.2 — Feb 2026

**Column Freeze**
- Right-click any column header → "Freeze up to this column" / "Unfreeze All Columns"
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

### v3.0+

- Cross-sheet formulas (`=Sheet2!A1` syntax), charts, pivot tables, conditional formatting, dashboard mode
- `=QUERY(doctype, fields, filters)` — range-spilling formula that pulls any DocType data into a sheet
- Smart Autofill — RandomForest predicts values per field per DocType
- Stock Reorder Predictor — days-to-reorder + suggested qty column (LinearReg + IsolationForest on Bin/SLE data)
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
