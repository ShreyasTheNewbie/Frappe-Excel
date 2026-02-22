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
- **Context menu** — Right-click to insert/delete rows, copy formulas
- **Export** — Export to `.xlsx` (Excel) or `.csv`
- **Import** — Import from `.xlsx` or `.csv` with column mapping
- **Inline save** — Cell edits sync back to Frappe DB in real time

---

## Installation

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO
bench install-app excel_view
bench build --app excel_view
```

---

## Release Notes

### v2.0 — Current (Feb 2026)
- **Lazy loading** — Split into two bundles: a 4KB router bundle (loads on every page) and a 1.6MB deps bundle (loads only when Excel View is opened). No performance cost for users who don't use Excel View.
- **Asset manifest resolution** — Uses `frappe.boot.assets_json` to correctly resolve content-hashed bundle URLs.

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

### v2.0 (in progress)
- **Field picker** — "Choose Columns" dialog to select which DocType fields to show, with drag-to-reorder. Column config saved server-side per user per DocType via `frappe.model.user_settings`.
- **Toolbar wiring** — All formatting buttons fully wired to range selections
- **Rich color palette** — Excel-style 3-section palette (theme colors, standard colors, recent colors)

### v2.1
- **Excel Workbooks** — Save named workbooks with formula columns, column layout, and filters. Load/switch workbooks from the toolbar.

### v2.2
- Column freeze, status bar (SUM/AVG/COUNT on selection), find & replace, cell comments

### v2.3
- `QUERY()` formula for parameterized data pulls, Frappe formula library (`=FRAPPE.GET()`, `=GL_BALANCE()`, `=STOCK_QTY()`), workflow actions from grid

### v3.0+
- Multiple sheet tabs, cross-sheet formulas, charts, pivot tables, conditional formatting, dashboard mode, ERP-native formula library

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
