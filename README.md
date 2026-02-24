# Excel View for Frappe / ERPNext

A full spreadsheet experience built into Frappe — edit, format, and analyze any DocType data in a familiar Excel-style grid, without leaving your ERP.

---

## Features

- **Spreadsheet grid** — powered by Handsontable 6.x, works with any DocType
- **Formula engine** — HyperFormula with 400+ built-in functions (SUM, IF, VLOOKUP, etc.)
- **Formula bar** — Excel-style formula editing with cell reference display
- **Custom cell editors** — Date picker, Link selector, Select listbox, Currency formatter, Checkbox
- **Formatting toolbar** — Bold, Italic, Underline, Strikethrough, Alignment, Wrap, Font, Size, Text color, Fill color
- **Autofill** — Drag formulas down/up with automatic relative reference adjustment
- **Context menu** — Right-click to insert/delete rows, hide/show columns, add formula columns
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
bench install-app excel_view
# bench install-app automatically runs bench build — no manual step needed
```

### Updating

```bash
cd apps/excel_view && git pull
bench build --app excel_view   # required after every pull (dist files are not committed)
```

---

## Release Notes

### v2.2 — Current (Feb 2026)

**Status Bar**
- Fixed footer below the grid showing live selection stats: address (A1:C5), Count, Sum, Average, Min, Max
- Values update on every selection change via HOT `afterSelection` hook
- Performance guard: skips numeric scan for selections > 5,000 cells
- Correctly handles formula cells (uses HyperFormula evaluated result)
- Numeric detection uses strict regex — date strings like `"2026-02-22"` are NOT counted as numbers

**Layout & Scrollbar fixes**
- Grid wrapper refactored to `flex-direction: column` so status bar always appears at bottom
- HOT height initialized via `setTimeout(0)` to read correct `clientHeight` after flex paint
- `ResizeObserver` also updates HOT height setting on resize — scrollbars always correct
- HOT horizontal/vertical scrollbars styled: 9px, gray thumb, visible on all platforms

---

### v2.1 — Saved Workbooks (Feb 2026)

**Excel Workbook DocType**
- Save named workbooks per DocType with: column selection, column order, column widths, formula columns
- Load/switch workbooks from the toolbar "Views" dropdown
- "Save View" split-button: overwrite current workbook or save as new
- My Workbooks / Shared Workbooks sections
- Delete workbook with confirmation
- Workbook state persists across sessions (server-side via Frappe DocType)

**Formula Columns**
- Add virtual columns not tied to any Frappe field
- Supports formulas (`=SUM`, `=IF`, etc.) and plain values
- Saved and restored as part of workbook
- Autofill works with relative reference adjustment

---

### v2.0 — Foundation (Feb 2026)

**Performance**
- **Lazy loading** — Split into two bundles: a 4KB router bundle (loads on every page) and a 1.6MB deps bundle (loads only when Excel View is opened). Zero cost for users who don't open Excel View.
- **Asset manifest resolution** — Uses `frappe.boot.assets_json` to correctly resolve content-hashed bundle URLs.

**Field Picker — "Choose Columns" dialog**
- Select which DocType fields to display in the grid
- Live search by label or fieldname
- Drag-to-reorder columns (order persists across sessions)
- Select All / Deselect All (scoped to visible/filtered rows)
- RBAC-aware — only shows fields the logged-in user has read permission for (respects `permlevel`)
- Column config saved server-side per user per DocType via `frappe.model.user_settings` (survives browser clear)
- Default columns: `in_list_view` fields sorted A→Z; user's saved order respected on subsequent loads
- `docstatus` and `idx` permanently excluded (use Status field for document state)

**Toolbar**
- All formatting buttons wired for single cell and multi-cell range selection
- `outsideClickDeselects: false` — toolbar clicks don't deselect the grid
- Rich color palette: 3-section Excel 2007 style (theme colors, standard colors, recent colors + custom hex)

**Grid refinements**
- Columns default sorted A→Z by label for any DocType
- `ResizeObserver` on grid wrapper — auto re-renders on sidebar toggle, panel resize, window resize
- Column widths persist per user per DocType
- Hide/show columns via right-click context menu
- Formula columns (virtual, not saved to DB)

---

### v1.0 — Initial Release

- Full spreadsheet grid for any DocType
- HyperFormula integration (400+ formulas)
- Formula bar, autofill with relative reference adjustment
- Custom cell editors: Date, Link, Select, Currency, Check
- Formatting toolbar: font, size, bold/italic/underline/strike, alignment, wrap, text color, fill color
- Context menu (insert/delete rows)
- Export to `.xlsx` / `.csv`, Import from `.xlsx` / `.csv`
- Inline real-time save to Frappe DB
- View switcher integration (appears alongside List, Kanban, Report views)

---

## Upcoming

### v2.2 (in progress)
- **Column freeze** — Right-click column header → "Freeze up to this column" (HOT `fixedColumnsLeft`)
- **Find & Replace** — Ctrl+H dialog with match case, whole cell, search in formulas options
- **Cell Comments** — Wire HOT's built-in comments plugin with @mention notifications

### v2.3
- `QUERY()` formula for parameterized data pulls
- Frappe formula library (`=FRAPPE.GET()`, `=GL_BALANCE()`, `=STOCK_QTY()`, `=ITEM_PRICE()`)
- Workflow actions from grid (Submit / Approve / Reject via right-click, bulk operations)

### v2.4 — Intelli-Sync (AI-Based Semantic VLOOKUP)
- **Auto-detect column relationships** — 3-layer engine: Regex naming series → Semantic existence sampling → NetworkX graph pathfinding
- **`=INTELLI_LINK(A2, "field_name")`** — custom HyperFormula function that fetches related DocType fields live
- **Zero schema knowledge required** — works even for denormalized/scripted columns without explicit Link fields
- **Perm-level enforcement** — restricted fields auto-masked (`***`) or column set `readOnly` based on user role

### v2.5 — Multi-Sheet Workbooks (pulled forward from v3)
- Sheet tab bar at bottom (like Excel / Google Sheets)
- Each tab = independent DocType with its own columns, filters, and data
- HyperFormula multi-sheet registration (foundation for cross-sheet formulas in v3)
- IntelliLookup preview — auto-suggest joins between sheets

### v3.0+
- Cross-sheet formulas, charts, pivot tables, conditional formatting, dashboard mode, Formula-AI (NL → QUERY())

---

## Tech Stack

| Layer | Library |
|---|---|
| Grid | [Handsontable](https://handsontable.com/) 6.2.2 (Community) |
| Formula engine | [HyperFormula](https://hyperformula.handsontable.com/) |
| CSV parsing | [PapaParse](https://www.papaparse.com/) |
| Excel export/import | [ExcelJS](https://github.com/exceljs/exceljs) (lazy-loaded) |
| Number formatting | [numfmt](https://github.com/borgar/numfmt) |

---

## Contributing

```bash
cd apps/excel_view
pre-commit install
bench build --app excel_view --watch
```

---

## License

MIT
