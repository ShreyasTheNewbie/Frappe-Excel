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

				<!-- ── Workbook: Save View + Views ─────────────────────────── -->
				<div class="ev-tb-group ev-wb-group">

					<!-- Split save button: [💾 Save View][▾] -->
					<div class="ev-wb-save-wrap">
						<button class="ev-tb-btn ev-wb-save-btn" title="${__("Save current view")}">
							<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
								<path d="M2 2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5.5L11.5 1H3a1 1 0 0 0-1 1zm0 1h9l3 3.5V13H2V3zm3 6h6v1H5v-1zm0-2h6v1H5V7z"/>
							</svg>
							<span class="ev-wb-save-label">${__("Save View")}</span>
						</button>
						<!-- Shown only when a workbook is active — click to deselect -->
						<button class="ev-tb-btn ev-wb-deselect-btn hide" title="${__("Deselect this view")}">×</button>
						<button class="ev-tb-btn ev-wb-dropdown-arrow" title="${__("More save options")}">▾</button>
						<!-- Dropdown menu -->
						<div class="ev-wb-dropdown hide">
							<button class="ev-wb-dd-item" data-action="save_as">${__("Save As…")}</button>
						</div>
					</div>

					<!-- Views browser -->
					<button class="ev-tb-btn ev-wb-views-btn" title="${__("Open a saved view")}">
						<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
							<path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z"/>
						</svg>
						${__("Views")}
					</button>
				</div>

				<div class="ev-tb-sep"></div>

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

				<!-- Link Sheets — IntelliFlow join canvas -->
				<div class="ev-tb-group">
					<button class="ev-tb-btn ev-join-btn"
						title="${__("Link Sheets — join data from another DocType")}">
						<svg width="14" height="14" viewBox="0 0 16 16" fill="none"
							stroke="currentColor" stroke-width="1.4" aria-hidden="true">
							<circle cx="3" cy="8" r="2.2"/>
							<circle cx="13" cy="3.5" r="2.2"/>
							<circle cx="13" cy="12.5" r="2.2"/>
							<line x1="5.1" y1="7.1" x2="10.9" y2="4.3"/>
							<line x1="5.1" y1="8.9" x2="10.9" y2="11.7"/>
						</svg>
						${__("Link Sheets")}
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

<!-- Horizontal Alignment -->
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

				<!-- Vertical Alignment -->
				<div class="ev-tb-group">
					<button class="ev-tb-btn ev-fmt-btn" data-fmt="valignTop"
						title="${__("Align Top")}">
						<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="1" width="12" height="1.5" rx="0.5"/><rect x="3" y="3.5" width="3" height="8" rx="0.5"/><rect x="8" y="3.5" width="3" height="5" rx="0.5"/></svg>
					</button>
					<button class="ev-tb-btn ev-fmt-btn" data-fmt="valignMiddle"
						title="${__("Align Middle")}">
						<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="6.25" width="12" height="1.5" rx="0.5"/><rect x="3" y="2" width="3" height="10" rx="0.5"/><rect x="8" y="3.5" width="3" height="7" rx="0.5"/></svg>
					</button>
					<button class="ev-tb-btn ev-fmt-btn" data-fmt="valignBottom"
						title="${__("Align Bottom")}">
						<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="11.5" width="12" height="1.5" rx="0.5"/><rect x="3" y="2" width="3" height="8" rx="0.5"/><rect x="8" y="4.5" width="3" height="5" rx="0.5"/></svg>
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
		// Excel 2007 Office theme — 10 base accent colors
		const THEME_BASES = [
			"#FFFFFF", "#000000", "#EEECE1", "#1F497D",
			"#4F81BD", "#C0504D", "#9BBB59", "#8064A2",
			"#4BACC6", "#F79646",
		];
		// 5 variation rows below base: tint 50%, tint 35%, tint 25%, shade 25%, shade 50%
		const VARIATIONS = [0.5, 0.35, 0.25, -0.25, -0.5];
		// Excel 2007 standard colors row
		const STANDARD = [
			"#C00000", "#FF0000", "#FFC000", "#FFFF00", "#92D050",
			"#00B050", "#00B0F0", "#0070C0", "#002060", "#7030A0",
		];

		const swatch = (c) =>
			`<span class="ev-swatch" data-color="${c}" style="background:${c}" title="${c}"></span>`;

		// Row 0: base theme colors
		let theme_html = THEME_BASES.map(swatch).join("");
		// Rows 1-5: tints and shades
		for (const f of VARIATIONS) {
			theme_html += THEME_BASES.map(c => swatch(this._vary_color(c, f))).join("");
		}

		const std_html = STANDARD.map(swatch).join("");

		return `
			<div class="ev-pal-section">
				<span class="ev-pal-label">${__("Theme Colors")}</span>
				<div class="ev-pal-grid ev-pal-theme-grid">${theme_html}</div>
			</div>
			<div class="ev-pal-rule"></div>
			<div class="ev-pal-section">
				<span class="ev-pal-label">${__("Standard Colors")}</span>
				<div class="ev-pal-grid ev-pal-std-grid">${std_html}</div>
			</div>
			<div class="ev-pal-rule"></div>
			<div class="ev-pal-recent-wrap hide">
				<span class="ev-pal-label">${__("Recent Colors")}</span>
				<div class="ev-pal-grid ev-pal-recent-grid"></div>
				<div class="ev-pal-rule"></div>
			</div>
			<button class="ev-pal-more-btn">
				<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style="flex-shrink:0">
					<circle cx="2" cy="6" r="1.5"/><circle cx="6" cy="6" r="1.5"/><circle cx="10" cy="6" r="1.5"/>
				</svg>
				${__("More Colors...")}
			</button>
			<div class="ev-pal-custom-panel hide">
				<input type="color" class="ev-custom-color" value="#000000">
				<input type="text" class="ev-hex-input" placeholder="#000000" maxlength="7">
				<button class="ev-hex-apply-btn">OK</button>
			</div>
		`;
	}

	_bind_events() {
		// Choose Columns button
		this.$toolbar.on("click", ".ev-columns-btn", () => {
			this.board.open_field_picker();
		});

		// Link Sheets — IntelliFlow join canvas
		this.$toolbar.on("click.ev-toolbar", ".ev-join-btn", () => {
			this.board._open_join_canvas();
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

		// More Colors toggle
		this.$palette.on("click", ".ev-pal-more-btn", (e) => {
			e.stopPropagation();
			const $panel = this.$palette.find(".ev-pal-custom-panel");
			$panel.toggleClass("hide");
			if (!$panel.hasClass("hide")) {
				// Pre-fill with the current cell's color
				const current = this._color_target === "color"
					? this._last_text_color : this._last_bg_color;
				const safe = /^#[0-9A-Fa-f]{6}$/.test(current) ? current : "#000000";
				$panel.find(".ev-custom-color").val(safe);
				$panel.find(".ev-hex-input").val(safe);
			}
		});

		// Native color picker → sync hex input (live preview, don't apply yet)
		this.$palette.on("input", ".ev-custom-color", (e) => {
			this.$palette.find(".ev-hex-input").val(e.target.value);
		});

		// Hex text input → sync native picker
		this.$palette.on("input", ".ev-hex-input", (e) => {
			const v = e.target.value.trim();
			if (/^#[0-9A-Fa-f]{6}$/i.test(v)) {
				this.$palette.find(".ev-custom-color").val(v);
			}
		});

		// Apply custom color (OK button)
		this.$palette.on("click", ".ev-hex-apply-btn", () => {
			const hex = this.$palette.find(".ev-hex-input").val().trim().toLowerCase();
			const color = /^#[0-9a-f]{6}$/.test(hex)
				? hex
				: this.$palette.find(".ev-custom-color").val();
			this._pick_color(color);
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
	 * Sync toolbar state (active buttons, dropdowns) with the current selection.
	 * For toggle buttons (bold/italic/etc): active only if ALL cells in range have the format.
	 * For dropdowns + color bars: reflect the top-left cell of the selection.
	 * Called on cell selection change.
	 */
	sync(row, col) {
		// Use current HOT range for multi-cell awareness; fall back to single cell.
		const range = this._get_range() || { r1: row, c1: col, r2: row, c2: col };

		// Top-left cell format drives dropdowns and color bars.
		const fmt = this.board.format_store?.[`${row}:${col}`] || {};

		// ── Toggle buttons ──────────────────────────────────────────────────
		const ALIGN_MAP  = { alignLeft: "left", alignCenter: "center", alignRight: "right" };
		const VALIGN_MAP = { valignTop: "top", valignMiddle: "middle", valignBottom: "bottom" };
		this.$toolbar.find(".ev-fmt-btn").each((_, btn) => {
			const f = $(btn).data("fmt");
			if (f.startsWith("align")) {
				const val = ALIGN_MAP[f];
				let all = true;
				outer: for (let r = range.r1; r <= range.r2; r++) {
					for (let c = range.c1; c <= range.c2; c++) {
						if ((this.board.format_store?.[`${r}:${c}`]?.align || null) !== val) {
							all = false; break outer;
						}
					}
				}
				$(btn).toggleClass("ev-active", all);
			} else if (f.startsWith("valign")) {
				const val = VALIGN_MAP[f];
				// Default is "middle" — active when all cells match (or have no valign = middle)
				let all = true;
				outer2: for (let r = range.r1; r <= range.r2; r++) {
					for (let c = range.c1; c <= range.c2; c++) {
						const cv = this.board.format_store?.[`${r}:${c}`]?.valign || "middle";
						if (cv !== val) { all = false; break outer2; }
					}
				}
				$(btn).toggleClass("ev-active", all);
			} else {
				// Bold/italic/underline/strike/wrap: active only if ALL cells have it
				$(btn).toggleClass("ev-active", this._all_have(range, f));
			}
		});

		// ── Dropdowns (top-left cell) ───────────────────────────────────────
		this.$font_family.val(fmt.font || "Calibri");
		this.$font_size.val(fmt.size || 12);

		// ── Color bars — always reset to current cell value or default ──────
		// Never leave a stale color from a previous selection.
		const text_color = fmt.color || "#000000";
		const bg_color   = fmt.bg    || "#FFFF00";
		this._last_text_color = text_color;
		this._last_bg_color   = bg_color;
		this.$toolbar.find(".ev-text-bar").css("background", text_color);
		this.$toolbar.find(".ev-bg-bar").css("background", bg_color);
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
		} else if (fmt_key.startsWith("valign")) {
			const val = { valignTop: "top", valignMiddle: "middle", valignBottom: "bottom" }[fmt_key];
			this._apply_to_range(range, (fmt) => {
				fmt.valign = val;
			});
		} else {
			const all_on = this._all_have(range, fmt_key);
			this._apply_to_range(range, (fmt) => {
				fmt[fmt_key] = !all_on;
			});
		}

		// Bold can slightly affect height; refresh to keep rows snug.
		const HEIGHT_FMT = new Set(["bold", "wrap"]);
		if (HEIGHT_FMT.has(fmt_key)) {
			this.board.refresh_row_heights(range.r1, range.r2);
		} else {
			this.board.hot.render();
		}
		const sel = this.board.hot.getSelectedLast();
		if (sel) this.sync(sel[0], sel[1]);
	}

	_apply_format(fmt_obj) {
		const range = this._get_range();
		if (!range) return;
		this._apply_to_range(range, (fmt) => Object.assign(fmt, fmt_obj));
		// Font size changes need row height recalculation.
		if (fmt_obj.size != null) {
			this.board.refresh_row_heights(range.r1, range.r2);
		} else {
			this.board.hot.render();
		}
	}

	_show_palette(trigger_el, type) {
		this._color_target = type;
		// Refresh recent swatches from localStorage each time the palette opens
		this._refresh_recent_swatches();
		// Collapse the custom panel if it was left open
		this.$palette.find(".ev-pal-custom-panel").addClass("hide");
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
		this._save_recent(color);
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

	// ── Color helpers ─────────────────────────────────────────────────────────

	/**
	 * Apply a tint (factor > 0, blends toward white) or shade (factor < 0,
	 * blends toward black) to a 6-digit hex color string.
	 * Matches the Excel 2007 Office-theme tint/shade math.
	 */
	_vary_color(hex, factor) {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		let nr, ng, nb;
		if (factor > 0) {
			nr = Math.round(r + (255 - r) * factor);
			ng = Math.round(g + (255 - g) * factor);
			nb = Math.round(b + (255 - b) * factor);
		} else {
			const s = -factor;
			nr = Math.round(r * (1 - s));
			ng = Math.round(g * (1 - s));
			nb = Math.round(b * (1 - s));
		}
		return "#" + [nr, ng, nb]
			.map(v => Math.min(255, Math.max(0, v)).toString(16).padStart(2, "0"))
			.join("");
	}

	_load_recent() {
		try {
			return JSON.parse(localStorage.getItem("ev_recent_colors") || "[]");
		} catch {
			return [];
		}
	}

	_save_recent(color) {
		let recent = this._load_recent().filter(c => c !== color);
		recent.unshift(color);
		localStorage.setItem("ev_recent_colors", JSON.stringify(recent.slice(0, 10)));
	}

	_refresh_recent_swatches() {
		const recent = this._load_recent();
		const $wrap = this.$palette.find(".ev-pal-recent-wrap");
		if (!recent.length) {
			$wrap.addClass("hide");
			return;
		}
		$wrap.removeClass("hide");
		$wrap.find(".ev-pal-recent-grid").html(
			recent.map(c =>
				`<span class="ev-swatch" data-color="${c}" style="background:${c}" title="${c}"></span>`
			).join("")
		);
	}
};
