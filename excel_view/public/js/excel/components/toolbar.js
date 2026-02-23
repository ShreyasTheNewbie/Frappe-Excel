/**
 * excel_view/components/toolbar.js
 *
 * Excel-style formatting toolbar.
 * Manages per-cell formatting stored in ExcelBoard.format_store,
 * applied via HOT's afterRenderer hook.
 *
 * Provides:
 *  • Font family / size selectors
 *  • Bold, Italic, Underline, Strikethrough
 *  • Text color + Fill color (40-color palette popup)
 *  • Align left / center / right
 *  • Wrap text toggle
 *
 * No external dependencies — @simonwep/pickr is available if needed later.
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.ExcelToolbar = class ExcelToolbar {
	/**
	 * @param {Object} opts
	 * @param {Object}  opts.board   - ExcelBoard instance
	 * @param {Element} opts.wrapper - DOM element to render into
	 */
	constructor(opts) {
		this.board = opts.board;
		this.wrapper = opts.wrapper;
		this._color_target = "color"; // 'color' | 'bg'
		this._last_text_color = "#000000";
		this._last_bg_color = "#FFFF00";
	}

	// ── Setup ─────────────────────────────────────────────────────────────────

	setup() {
		this._render();
		this._bind_events();
	}

	_render() {
		const fonts = [
			"Calibri", "Arial", "Times New Roman",
			"Courier New", "Georgia", "Verdana", "Trebuchet MS",
		];
		const sizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48];

		$(this.wrapper).html(`
			<div class="ev-toolbar">
				<!-- Choose Columns -->
				<div class="ev-tb-group">
					<button class="ev-tb-btn ev-columns-btn" title="${__("Choose Columns")}">
						<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
							<rect x="1" y="1" width="4" height="14" rx="1"/>
							<rect x="6" y="1" width="4" height="14" rx="1"/>
							<rect x="11" y="1" width="4" height="14" rx="1"/>
						</svg>
					</button>
				</div>

				<div class="ev-tb-sep"></div>

				<!-- Font family -->
				<div class="ev-tb-group">
					<select class="ev-tb-select ev-tb-font-family" title="${__("Font")}">
						${fonts.map(f => `<option value="${f}"${f === "Calibri" ? " selected" : ""}>${f}</option>`).join("")}
					</select>
				</div>
				<!-- Font size -->
				<div class="ev-tb-group">
					<select class="ev-tb-select ev-tb-font-size" title="${__("Font Size")}">
						${sizes.map(s => `<option value="${s}"${s === 12 ? " selected" : ""}>${s}</option>`).join("")}
					</select>
				</div>

				<div class="ev-tb-sep"></div>

				<!-- Bold / Italic / Underline / Strikethrough -->
				<div class="ev-tb-group">
					<button class="ev-tb-btn ev-fmt-btn" data-fmt="bold"
						title="${__("Bold")} (Ctrl+B)"><b>B</b></button>
					<button class="ev-tb-btn ev-fmt-btn" data-fmt="italic"
						title="${__("Italic")} (Ctrl+I)"><i>I</i></button>
					<button class="ev-tb-btn ev-fmt-btn ev-btn-underline" data-fmt="underline"
						title="${__("Underline")} (Ctrl+U)">U</button>
					<button class="ev-tb-btn ev-fmt-btn ev-btn-strike" data-fmt="strike"
						title="${__("Strikethrough")}">S</button>
				</div>

				<div class="ev-tb-sep"></div>

				<!-- Text color / Fill color -->
				<div class="ev-tb-group">
					<button class="ev-tb-btn ev-color-trigger" data-type="color"
						title="${__("Font Color")}">
						<span class="ev-tb-color-icon">A</span>
						<span class="ev-tb-color-bar ev-text-bar"
							style="background:${this._last_text_color}"></span>
					</button>
					<button class="ev-tb-btn ev-color-trigger" data-type="bg"
						title="${__("Fill Color")}">
						<span class="ev-tb-color-icon ev-bucket">◩</span>
						<span class="ev-tb-color-bar ev-bg-bar"
							style="background:${this._last_bg_color}"></span>
					</button>
				</div>

				<div class="ev-tb-sep"></div>

				<!-- Alignment -->
				<div class="ev-tb-group">
					<button class="ev-tb-btn ev-fmt-btn" data-fmt="alignLeft"
						title="${__("Align Left")}">
						<span class="ev-align-icon ev-align-left"></span>
					</button>
					<button class="ev-tb-btn ev-fmt-btn" data-fmt="alignCenter"
						title="${__("Align Center")}">
						<span class="ev-align-icon ev-align-center"></span>
					</button>
					<button class="ev-tb-btn ev-fmt-btn" data-fmt="alignRight"
						title="${__("Align Right")}">
						<span class="ev-align-icon ev-align-right"></span>
					</button>
				</div>

				<div class="ev-tb-sep"></div>

				<!-- Wrap text -->
				<div class="ev-tb-group">
					<button class="ev-tb-btn ev-fmt-btn" data-fmt="wrap"
						title="${__("Wrap Text")}">
						<span class="ev-wrap-icon">↵</span>
					</button>
				</div>
			</div>

			<!-- Color palette popup (shared for text + fill) -->
			<div class="ev-palette-popup hide">
				${this._palette_html()}
			</div>
		`);

		this.$toolbar = $(this.wrapper).find(".ev-toolbar");
		this.$palette = $(this.wrapper).find(".ev-palette-popup");
		this.$font_family = this.$toolbar.find(".ev-tb-font-family");
		this.$font_size = this.$toolbar.find(".ev-tb-font-size");
	}

	_palette_html() {
		// 40-color standard palette (2 rows of 20 = 4 rows of 10)
		const colors = [
			// Row 1: blacks + grays + white
			"#000000", "#1F2937", "#374151", "#6B7280", "#9CA3AF",
			"#D1D5DB", "#E5E7EB", "#F3F4F6", "#F9FAFB", "#FFFFFF",
			// Row 2: reds + oranges + yellows
			"#7F0000", "#C00000", "#FF0000", "#FF4500", "#FF8C00",
			"#FFA500", "#FFD700", "#FFFF00", "#FFFF9C", "#FFF2CC",
			// Row 3: greens + cyans + blues
			"#002060", "#0070C0", "#00B0F0", "#00FFFF", "#00B050",
			"#92D050", "#008000", "#E2EFDA", "#C6EFCE", "#DDEBF7",
			// Row 4: purples + pinks
			"#7030A0", "#9B59B6", "#EA4C89", "#FF1493", "#C00099",
			"#FFD7E9", "#FCE4D6", "#FFC7CE", "#FFEB9C", "#D6E4BC",
		];
		return `
			<div class="ev-palette-grid">
				${colors.map(c => `<span class="ev-swatch" data-color="${c}"
					style="background:${c}" title="${c}"></span>`).join("")}
			</div>
			<div class="ev-palette-custom">
				<input type="color" class="ev-custom-color" value="#000000"
					title="${__("Custom color")}">
				<span>${__("More colors...")}</span>
			</div>
		`;
	}

	_bind_events() {
		// Choose Columns button
		this.$toolbar.on("click", ".ev-columns-btn", () => {
			this.board.open_field_picker();
		});

		// Format toggle buttons (bold, italic, underline, strike, alignment, wrap)
		this.$toolbar.on("click", ".ev-fmt-btn", (e) => {
			const fmt = $(e.currentTarget).data("fmt");
			this._toggle_format(fmt);
		});

		// Font family
		this.$font_family.on("change", () => {
			this._apply_format({ font: this.$font_family.val() });
		});

		// Font size
		this.$font_size.on("change", () => {
			this._apply_format({ size: parseInt(this.$font_size.val(), 10) });
		});

		// Color trigger buttons
		this.$toolbar.on("click", ".ev-color-trigger", (e) => {
			e.stopPropagation();
			const type = $(e.currentTarget).data("type");
			this._show_palette(e.currentTarget, type);
		});

		// Swatch click
		this.$palette.on("click", ".ev-swatch", (e) => {
			this._pick_color($(e.currentTarget).data("color"));
		});

		// Custom color input
		this.$palette.on("input change", ".ev-custom-color", (e) => {
			this._pick_color(e.target.value);
		});

		// Close palette on outside click
		$(document).on("click.ev-toolbar", (e) => {
			if (!$(e.target).closest(".ev-palette-popup, .ev-color-trigger").length) {
				this.$palette.addClass("hide");
			}
		});
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Sync toolbar state (active buttons, dropdowns) with a cell's stored format.
	 * Called on cell selection.
	 */
	sync(row, col) {
		const fmt = this.board.format_store?.[`${row}:${col}`] || {};

		// Toggle active state on format buttons
		this.$toolbar.find(".ev-fmt-btn").each((_, btn) => {
			const f = $(btn).data("fmt");
			if (f.startsWith("align")) {
				const val = { alignLeft: "left", alignCenter: "center", alignRight: "right" }[f];
				$(btn).toggleClass("ev-active", fmt.align === val);
			} else {
				$(btn).toggleClass("ev-active", !!fmt[f]);
			}
		});

		// Sync dropdowns
		this.$font_family.val(fmt.font || "Calibri");
		this.$font_size.val(fmt.size || 12);

		// Sync color bars
		if (fmt.color) {
			this._last_text_color = fmt.color;
			this.$toolbar.find(".ev-text-bar").css("background", fmt.color);
		}
		if (fmt.bg) {
			this._last_bg_color = fmt.bg;
			this.$toolbar.find(".ev-bg-bar").css("background", fmt.bg);
		}
	}

	/**
	 * Toggle a named format (called from keyboard shortcuts in excel_board.js).
	 */
	toggle(fmt_key) {
		this._toggle_format(fmt_key);
	}

	destroy() {
		$(document).off("click.ev-toolbar");
		$(this.wrapper).empty();
	}

	// ── Private ───────────────────────────────────────────────────────────────

	_get_range() {
		const sel = this.board.hot?.getSelectedLast();
		if (!sel) return null;
		return {
			r1: Math.min(sel[0], sel[2]),
			c1: Math.min(sel[1], sel[3]),
			r2: Math.max(sel[0], sel[2]),
			c2: Math.max(sel[1], sel[3]),
		};
	}

	_toggle_format(fmt_key) {
		const range = this._get_range();
		if (!range) return;

		if (fmt_key.startsWith("align")) {
			const val = { alignLeft: "left", alignCenter: "center", alignRight: "right" }[fmt_key];
			this._apply_to_range(range, (fmt) => {
				fmt.align = fmt.align === val ? null : val;
			});
		} else {
			const all_on = this._all_have(range, fmt_key);
			this._apply_to_range(range, (fmt) => {
				fmt[fmt_key] = !all_on;
			});
		}

		this.board.hot.render();
		const sel = this.board.hot.getSelectedLast();
		if (sel) this.sync(sel[0], sel[1]);
	}

	_apply_format(fmt_obj) {
		const range = this._get_range();
		if (!range) return;
		this._apply_to_range(range, (fmt) => Object.assign(fmt, fmt_obj));
		this.board.hot.render();
	}

	_show_palette(trigger_el, type) {
		this._color_target = type;
		const btn_rect = trigger_el.getBoundingClientRect();
		const wrap_rect = this.wrapper.getBoundingClientRect();
		this.$palette.css({
			top: btn_rect.bottom - wrap_rect.top + 2,
			left: Math.max(0, btn_rect.left - wrap_rect.left),
		}).removeClass("hide");
	}

	_pick_color(color) {
		const range = this._get_range();
		if (range) {
			const key = this._color_target === "color" ? "color" : "bg";
			this._apply_to_range(range, (fmt) => { fmt[key] = color; });
			this.board.hot.render();
			if (key === "color") {
				this._last_text_color = color;
				this.$toolbar.find(".ev-text-bar").css("background", color);
			} else {
				this._last_bg_color = color;
				this.$toolbar.find(".ev-bg-bar").css("background", color);
			}
		}
		this.$palette.addClass("hide");
	}

	_apply_to_range(range, fn) {
		if (!this.board.format_store) this.board.format_store = {};
		for (let r = range.r1; r <= range.r2; r++) {
			for (let c = range.c1; c <= range.c2; c++) {
				const k = `${r}:${c}`;
				if (!this.board.format_store[k]) this.board.format_store[k] = {};
				fn(this.board.format_store[k]);
				// Prune empty format objects
				if (!Object.values(this.board.format_store[k]).some(Boolean)) {
					delete this.board.format_store[k];
				}
			}
		}
	}

	_all_have(range, fmt_key) {
		for (let r = range.r1; r <= range.r2; r++) {
			for (let c = range.c1; c <= range.c2; c++) {
				if (!this.board.format_store?.[`${r}:${c}`]?.[fmt_key]) return false;
			}
		}
		return true;
	}
};
