/**
 * excel_view/components/join_canvas.js
 *
 * IntelliFlow — Visual Join Canvas (V2.4 — bug-fix r2)
 *
 * Full-screen overlay canvas for building SQL JOINs visually:
 *   - HTML div "nodes" (one per DocType) are draggable on a dotted-grid stage
 *   - SVG bezier "edges" connect field ports between nodes
 *   - Each connection is validated in real-time via 2-layer AI:
 *       Layer 1: Frappe meta Link field detection (instant)
 *       Layer 2: Data value overlap sampling (async, 200 rows per side)
 *   - "Apply" executes a dynamic LEFT JOIN on the backend and injects
 *     the result as read-only virtual columns into the HOT grid
 *
 * Bug fixes (r2):
 *   F1 — Header title stays on one line (CSS overflow + nowrap)
 *   F2 — Field checkboxes appear immediately on non-base nodes (no wire needed first)
 *        Checkboxes are tracked per-node; only applied to edges with valid connections
 *   F3 — frappe.prompt dialog appears above canvas overlay:
 *        body.ev-jc-open class → CSS bumps .modal z-index to 1700 (> canvas 1500)
 *   F4 — Wire drawing uses document-level mousemove/mouseup (robust across all child els)
 *   F5 — Escape key guard: canvas doesn't close when a frappe modal is open
 *   F6 — Field rows placed inside .ev-jc-node-fields div → proper scrolling
 *
 * Usage (called from ExcelBoard._open_join_canvas):
 *   this.join_canvas = new frappe.views.excel.JoinCanvas({ board: this });
 *   this.join_canvas.open(board._last_join_config || null);
 *   // Pass board._last_join_config so canvas reopens with existing connections.
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.JoinCanvas = class JoinCanvas {
	// ── Constructor ───────────────────────────────────────────────────────────

	constructor({ board }) {
		this.board = board;
		// Map<node_id, {id, doctype, el, selected_fields: Set<string>}>
		this.nodes = new Map();
		// [{id, src_node_id, src_field, tgt_node_id, tgt_field,
		//   valid, confidence, method, path_el, badge_el}]
		this.edges = [];
		// Active wire state while user drags a connection
		this._wire = null; // {src_node_id, src_field, path_el}
		this._node_ctr = 0;
		this._edge_ctr = 0;
		// Tracks which node the ✨ AI drawer fetches suggestions FOR.
		// null = use board.doctype (base node).  Set by clicking the ✨ icon on any node.
		this._ai_target_node_id = null;
		// Bound handlers kept for later removal
		this._on_key           = this._on_key.bind(this);
		this._doc_mousemove    = this._on_doc_mousemove.bind(this);
		this._doc_mouseup      = this._on_doc_mouseup.bind(this);
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	/**
	 * Open the canvas overlay.
	 *
	 * @param {Object|null} initial_config - Optional join_config to restore immediately.
	 *   When provided (e.g. from board._last_join_config after a workbook was loaded),
	 *   this config is used instead of reading from user_settings.  This allows the
	 *   canvas to show existing connections when the user clicks "Link Sheets" while
	 *   a join-based workbook is already active.
	 */
	open(initial_config = null) {
		this._build_overlay();
		// Mark body so CSS can bump frappe modal z-index above canvas (F3)
		document.body.classList.add("ev-jc-open");
		// Remember that the canvas is open — survives page refresh
		frappe.model.user_settings.save(this.board.doctype, "excel_join_canvas_open", true);
		// Seed the base node from the current DocType, then restore any saved state
		frappe.model.with_doctype(this.board.doctype, () => {
			this._add_node(this.board.doctype, { base: true });
			// Priority: active join config (workbook loaded) > user_settings (last Apply)
			const has_content = cfg =>
				cfg?.nodes?.some(n => n.doctype !== this.board.doctype) ||
				cfg?.edges?.length > 0;

			if (has_content(initial_config)) {
				this._restore_from_config(initial_config);
				// V2.4.5 — show Patterns button if a join is already applied
				if (initial_config?.edges?.filter(e => e.valid !== false).length) {
					this.$overlay.find(".ev-jc-patterns-btn").show();
					this.$overlay.find(".ev-jc-analyze-btn").show();
				}
			} else {
				this._restore_from_user_settings();
			}
		});
		$(document).on("keydown.ev-jc", this._on_key);
	}

	close() {
		$(document).off("keydown.ev-jc");
		document.body.classList.remove("ev-jc-open");
		this.$overlay?.remove();
		this.$overlay = null;
		// Clear the "canvas is open" flag so it doesn't reopen after the next refresh
		frappe.model.user_settings.save(this.board.doctype, "excel_join_canvas_open", false);
		// Clean up any lingering document listeners from an interrupted wire drag
		document.removeEventListener("mousemove", this._doc_mousemove);
		document.removeEventListener("mouseup",   this._doc_mouseup);
	}

	// F5 — guard: don't close canvas when a frappe dialog is open
	_on_key(e) {
		if (e.key === "Escape") {
			if ($(".modal.show, .modal.in").length) return; // a dialog is open
			this.close();
		}
	}

	// ── Overlay DOM ───────────────────────────────────────────────────────────

	_build_overlay() {
		this.$overlay = $(`
			<div class="ev-canvas-overlay">
				<div class="ev-jc-header">
					<span class="ev-jc-header-title">
						${frappe.utils.escape_html(__("Link Sheets"))}
						<span class="ev-jc-header-dt">— ${frappe.utils.escape_html(this.board.doctype)}</span>
					</span>
					<div class="ev-jc-header-actions">
						<button class="btn btn-sm btn-default ev-jc-ai-btn"
						        title="${__("AI Discover — suggest joins from schema analysis")}">
							✨ ${__("AI")}
						</button>
						<button class="btn btn-sm btn-default ev-jc-path-btn"
						        title="${__("Find Path — auto-chain via shortest link path")}">
							🔗 ${__("Path")}
						</button>
						<button class="btn btn-sm btn-default ev-jc-add-btn">
							+ ${__("Add DocType")}
						</button>
						<button class="btn btn-sm btn-default ev-jc-preview-btn">
							${__("Preview")}
						</button>
						<button class="btn btn-sm btn-primary ev-jc-apply-btn">
							${__("Apply")}
						</button>
						<button class="btn btn-sm btn-default ev-jc-patterns-btn" style="display:none"
						        title="${__("Discover business patterns in joined data")}">
							📊 ${__("Patterns")}
						</button>
						<button class="btn btn-sm btn-default ev-jc-analyze-btn" style="display:none"
						        title="${__("AI Analysis — anomaly detection and clustering on joined data")}">
							🤖 ${__("Analyze")}
						</button>
						<button class="btn btn-sm btn-default ev-jc-close-btn">✕</button>
					</div>
				</div>
				<div class="ev-jc-stage">
					<svg class="ev-jc-svg" xmlns="http://www.w3.org/2000/svg"></svg>
					<div class="ev-jc-nodes"></div>
					<div class="ev-jc-hint">
						<b>${__("How to use:")}</b>
						${__("1. Add a DocType node. &nbsp; 2. Drag ○ (right side) → drop on ○ (left side of another field) to create a join. &nbsp; 3. Check fields to include in the grid. &nbsp; 4. Click Apply.")}
					</div>
				</div>
			</div>
		`).appendTo(document.body);

		this.$stage = this.$overlay.find(".ev-jc-stage");
		this.$svg   = this.$overlay.find(".ev-jc-svg")[0];
		this.$nodes = this.$overlay.find(".ev-jc-nodes");

		// Header button events
		this.$overlay.find(".ev-jc-close-btn").on("click",    () => this.close());
		this.$overlay.find(".ev-jc-add-btn").on("click",      () => this._prompt_add_node());
		this.$overlay.find(".ev-jc-preview-btn").on("click",  () => this._show_preview());
		this.$overlay.find(".ev-jc-apply-btn").on("click",    () => this._apply());
		// V2.4.5 AI buttons
		this.$overlay.find(".ev-jc-ai-btn").on("click",       () => this._toggle_ai_discover());
		this.$overlay.find(".ev-jc-path-btn").on("click",     () => this._run_find_path());
		this.$overlay.find(".ev-jc-patterns-btn").on("click", () => this._run_pattern_mining());
		// V2.5 AI Analysis button
		this.$overlay.find(".ev-jc-analyze-btn").on("click",  () => this._open_analyze_panel());
	}

	// ── Node management ───────────────────────────────────────────────────────

	_prompt_add_node() {
		// frappe.prompt z-index is bumped above canvas via body.ev-jc-open CSS (F3)
		frappe.prompt(
			[{
				fieldtype: "Link",
				fieldname: "doctype",
				label:     __("DocType"),
				options:   "DocType",
				reqd:      1,
			}],
			({ doctype }) => {
				if ([...this.nodes.values()].find(n => n.doctype === doctype)) {
					frappe.show_alert(
						{ message: __("{0} is already added", [doctype]), indicator: "orange" },
						3
					);
					return;
				}
				frappe.model.with_doctype(doctype, () => this._add_node(doctype, { base: false }));
			},
			__("Add DocType"),
			__("Add"),
		);
	}

	_add_node(doctype, { base = false } = {}) {
		const id   = `node_${this._node_ctr++}`;
		const meta = frappe.get_meta(doctype);

		// Detect child table (istable=1 in Frappe meta)
		const is_child = !!meta?.istable;

		const SKIP_TYPES = new Set([
			"Column Break", "Section Break", "Tab Break", "Fold",
			"Heading", "HTML", "Custom HTML", "Table", "Table MultiSelect", "Password",
		]);
		// Child table system fields — not useful for joins/display
		const CHILD_SYS_FIELDS = new Set(["parent", "parenttype", "parentfield", "idx"]);

		const fields = (meta?.fields || []).filter(
			df => !SKIP_TYPES.has(df.fieldtype) && !df.is_virtual && df.fieldname !== "name"
				&& !(is_child && CHILD_SYS_FIELDS.has(df.fieldname))
		);

		// Auto-layout: cascade horizontally by 280px per node
		const existing_count = this.nodes.size;
		const left = 40 + existing_count * 280;
		const top  = 60;

		const node_el = document.createElement("div");
		node_el.className = "ev-jc-node"
			+ (base ? " ev-jc-node--base" : "")
			+ (is_child && !base ? " ev-jc-node--child" : "");
		node_el.dataset.id = id;
		node_el.style.left = left + "px";
		node_el.style.top  = top  + "px";

		// ── Header ──
		const hdr = document.createElement("div");
		hdr.className = "ev-jc-node-header";
		hdr.innerHTML = `
			<span class="ev-jc-node-title">${frappe.utils.escape_html(doctype)}</span>
			${is_child && !base ? `<span class="ev-jc-ct-badge" title="${__("Child Table")}">CT</span>` : ""}
			<button class="ev-jc-node-ai-target" title="${__("AI suggest from this node")}">✨</button>
			<span class="ev-jc-node-count${base ? " ev-jc-node-count--base" : ""}"
			      title="${__("Fields selected for grid")}">0 ${__("selected")}</span>
			${!base
				? `<button class="ev-jc-node-remove" title="${__("Remove")}">✕</button>`
				: ""}
		`;
		node_el.appendChild(hdr);

		// ── Scrollable field list (F6) ──
		const fields_div = document.createElement("div");
		fields_div.className = "ev-jc-node-fields";

		// "name" field row (always shown)
		fields_div.appendChild(this._make_field_row({ fieldname: "name", label: "Name (ID)" }, id, base));

		// All other fields
		fields.forEach(df => {
			fields_div.appendChild(this._make_field_row(df, id, base));
		});

		node_el.appendChild(fields_div);
		this.$nodes[0].appendChild(node_el);

		// Store node — selected_fields Set tracked per-node (F2)
		this.nodes.set(id, { id, doctype, el: node_el, selected_fields: new Set() });

		// Bind drag on header
		this._bind_node_drag(hdr, node_el);

		// ✨ AI-target button — sets this node as the active suggestion source
		hdr.querySelector(".ev-jc-node-ai-target").addEventListener("click", (e) => {
			e.stopPropagation();
			this._set_ai_target(id);
		});

		if (base) {
			// Base node: show checkboxes pre-checked for currently visible HOT columns
			const pre_check = new Set(this.board.columns.map(c => c.data));
			this._add_field_checkboxes(id, fields_div, pre_check);
		} else {
			// Non-base: wire remove button
			hdr.querySelector(".ev-jc-node-remove")
				?.addEventListener("click", (e) => {
					e.stopPropagation();
					this._remove_node(id);
				});

			if (is_child) {
				// ── CT node: no per-row checkboxes; field rows kept for port dots ──
				// Aggregate panel replaces Transform panel for CT nodes.
				// _make_field_row already added port dots — checkboxes hidden via CSS.
				this._add_aggregate_panel(node_el, id, doctype, fields);
			} else {
				// ── Regular non-base node: checkboxes + Transform panel ─────────
				this._add_field_checkboxes(id, fields_div, null);

				// ── Transform Panel (V2.5) ──────────────────────────────────────
				this._add_transform_panel(node_el, id, doctype, fields);
			}
		}

		return id;
	}

	/**
	 * Append a collapsible Transform panel to a non-base node.
	 * Panel contains: Row Filter rows + Computed Column rows.
	 *
	 * @param {HTMLElement} node_el   - the node container div
	 * @param {string}      node_id   - stable node id
	 * @param {string}      doctype   - node doctype
	 * @param {Object[]}    meta_fields - frappe meta fields (for field dropdown)
	 */
	_add_transform_panel(node_el, node_id, doctype, meta_fields) {
		const tf = document.createElement("div");
		tf.className = "ev-jc-node-transform";
		tf.dataset.nodeId = node_id;
		tf.innerHTML = `
			<div class="ev-jc-transform-header" tabindex="0">
				<span class="ev-tf-title">🔧 ${__("Transform")}</span>
				<span class="ev-jc-transform-badge ev-jc-transform-badge--hidden">0 ${__("rules")}</span>
				<span class="ev-jc-transform-toggle">▸</span>
			</div>
			<div class="ev-jc-transform-body" style="display:none">
				<div class="ev-tf-section-label">${__("Row Filter")}</div>
				<div class="ev-tf-filters"></div>
				<button class="ev-tf-add-filter btn btn-xs btn-default">+ ${__("Add Filter")}</button>
				<div class="ev-tf-section-label" style="margin-top:8px">${__("Computed Column")}</div>
				<div class="ev-tf-computed"></div>
				<button class="ev-tf-add-computed btn btn-xs btn-default">+ ${__("Add Column")}</button>
			</div>
		`;
		node_el.appendChild(tf);

		// Toggle body on header click
		const header_el = tf.querySelector(".ev-jc-transform-header");
		const body_el   = tf.querySelector(".ev-jc-transform-body");
		const toggle_el = tf.querySelector(".ev-jc-transform-toggle");
		header_el.addEventListener("click", () => {
			const open = body_el.style.display !== "none";
			body_el.style.display = open ? "none" : "block";
			toggle_el.textContent = open ? "▸" : "▾";
		});

		// "+ Add Filter" row
		const filters_container   = tf.querySelector(".ev-tf-filters");
		const computed_container  = tf.querySelector(".ev-tf-computed");
		const badge_el            = tf.querySelector(".ev-jc-transform-badge");

		const _update_badge = () => {
			const f_count = filters_container.querySelectorAll(".ev-tf-filter-row").length;
			const c_count = computed_container.querySelectorAll(".ev-tf-computed-row").length;
			const total   = f_count + c_count;
			badge_el.textContent = `${total} ${__("rules")}`;
			badge_el.classList.toggle("ev-jc-transform-badge--hidden", total === 0);
		};

		tf.querySelector(".ev-tf-add-filter").addEventListener("click", (e) => {
			e.stopPropagation();
			this._add_filter_row(filters_container, meta_fields, _update_badge);
		});
		tf.querySelector(".ev-tf-add-computed").addEventListener("click", (e) => {
			e.stopPropagation();
			this._add_computed_row(computed_container, _update_badge);
		});
	}

	/** Append one Row Filter row to the filters container. */
	_add_filter_row(container, meta_fields, on_change, saved = null) {
		const row = document.createElement("div");
		row.className = "ev-tf-filter-row";

		const field_opts = meta_fields.map(df =>
			`<option value="${frappe.utils.escape_html(df.fieldname)}"
			         ${saved?.field === df.fieldname ? "selected" : ""}>${frappe.utils.escape_html(df.label || df.fieldname)}</option>`
		).join("");

		const ops = ["=", "!=", ">", "<", ">=", "<=", "like", "in"];
		const op_opts = ops.map(op =>
			`<option value="${op}" ${saved?.op === op ? "selected" : ""}>${op}</option>`
		).join("");

		row.innerHTML = `
			<select class="ev-tf-field form-control form-control-sm">${field_opts}</select>
			<select class="ev-tf-op    form-control form-control-sm">${op_opts}</select>
			<input  class="ev-tf-val   form-control form-control-sm"
			        placeholder="${__("value")}" value="${frappe.utils.escape_html(saved?.value || "")}">
			<button class="ev-tf-row-del btn btn-xs" title="${__("Remove")}">×</button>
		`;
		row.querySelector(".ev-tf-row-del").addEventListener("click", () => {
			row.remove();
			on_change?.();
		});
		container.appendChild(row);
		on_change?.();
	}

	/** Append one Computed Column row to the computed container. */
	_add_computed_row(container, on_change, saved = null) {
		const key = saved?.key || `_computed_${Date.now()}`;
		const row = document.createElement("div");
		row.className = "ev-tf-computed-row";
		row.dataset.key = key;
		row.innerHTML = `
			<input class="ev-tf-col-label form-control form-control-sm"
			       placeholder="${__("Column label")}" value="${frappe.utils.escape_html(saved?.label || "")}">
			<textarea class="ev-tf-col-expr form-control form-control-sm" rows="2"
			          placeholder="${__('e.g. "Senior" if years_of_experience > 5 else "Junior"')}">${frappe.utils.escape_html(saved?.expr || "")}</textarea>
			<button class="ev-tf-row-del btn btn-xs" title="${__("Remove")}">×</button>
		`;
		row.querySelector(".ev-tf-row-del").addEventListener("click", () => {
			row.remove();
			on_change?.();
		});
		container.appendChild(row);
		on_change?.();
	}

	/** Read Transform panel state for a node → {row_filter, computed_cols}. */
	_get_node_transform_config(node_id) {
		const node_el = this.nodes.get(node_id)?.el;
		if (!node_el) return { row_filter: [], computed_cols: [] };

		const tf = node_el.querySelector(".ev-jc-node-transform");
		if (!tf) return { row_filter: [], computed_cols: [] };

		const row_filter = [...tf.querySelectorAll(".ev-tf-filter-row")].map(r => ({
			field: r.querySelector(".ev-tf-field")?.value || "",
			op:    r.querySelector(".ev-tf-op")?.value    || "=",
			value: r.querySelector(".ev-tf-val")?.value   || "",
		})).filter(f => f.field);

		const computed_cols = [...tf.querySelectorAll(".ev-tf-computed-row")].map(r => ({
			key:   r.dataset.key || `_col_${Math.random().toString(36).slice(2)}`,
			label: r.querySelector(".ev-tf-col-label")?.value || "",
			expr:  r.querySelector(".ev-tf-col-expr")?.value  || "",
		})).filter(c => c.label && c.expr);

		return { row_filter, computed_cols };
	}

	/** Restore Transform panel UI from saved config (called in _restore_from_config). */
	_restore_transform_panel(node_id, transform_cfg, meta_fields) {
		const node_el = this.nodes.get(node_id)?.el;
		if (!node_el || !transform_cfg) return;

		const tf = node_el.querySelector(".ev-jc-node-transform");
		if (!tf) return;

		const filters_container  = tf.querySelector(".ev-tf-filters");
		const computed_container = tf.querySelector(".ev-tf-computed");
		const badge_el           = tf.querySelector(".ev-jc-transform-badge");

		const _update_badge = () => {
			const total = filters_container.querySelectorAll(".ev-tf-filter-row").length
			            + computed_container.querySelectorAll(".ev-tf-computed-row").length;
			badge_el.textContent = `${total} ${__("rules")}`;
			badge_el.classList.toggle("ev-jc-transform-badge--hidden", total === 0);
		};

		(transform_cfg.row_filter || []).forEach(f =>
			this._add_filter_row(filters_container, meta_fields, _update_badge, f)
		);
		(transform_cfg.computed_cols || []).forEach(c =>
			this._add_computed_row(computed_container, _update_badge, c)
		);

		// Auto-expand panel if there are rules
		const total = (transform_cfg.row_filter?.length || 0) + (transform_cfg.computed_cols?.length || 0);
		if (total > 0) {
			tf.querySelector(".ev-jc-transform-body").style.display = "block";
			tf.querySelector(".ev-jc-transform-toggle").textContent = "▾";
		}
	}

	// ── CT Aggregate Panel ────────────────────────────────────────────────────
	// Replaces Transform panel on child-table nodes.
	// Each row = one aggregated output column: func(field) → 1 row per parent record.

	/**
	 * Append the Aggregate panel to a CT node.
	 * @param {HTMLElement} node_el    - node container div
	 * @param {string}      node_id    - stable node id
	 * @param {string}      doctype    - CT doctype name
	 * @param {Object[]}    meta_fields - filtered Frappe meta fields
	 */
	_add_aggregate_panel(node_el, node_id, doctype, meta_fields) {
		const ag = document.createElement("div");
		ag.className  = "ev-jc-node-aggregate";
		ag.dataset.nodeId = node_id;
		ag.innerHTML = `
			<div class="ev-jc-agg-header">
				<span class="ev-jc-agg-title">📊 ${__("Aggregate")}</span>
				<span class="ev-jc-agg-badge ev-jc-agg-badge--hidden">0 ${__("cols")}</span>
			</div>
			<div class="ev-jc-agg-body">
				<div class="ev-jc-agg-rows"></div>
				<button class="ev-jc-agg-add btn btn-xs btn-default">+ ${__("Add Column")}</button>
				<div class="ev-jc-agg-hint">
					${__("Each row becomes one aggregated column (1 result row per parent record).")}
				</div>
			</div>
		`;
		node_el.appendChild(ag);

		const rows_container = ag.querySelector(".ev-jc-agg-rows");
		const badge_el       = ag.querySelector(".ev-jc-agg-badge");
		const count_el       = node_el.querySelector(".ev-jc-node-count");

		const _update = () => {
			const n = rows_container.querySelectorAll(".ev-jc-agg-row").length;
			badge_el.textContent = `${n} ${__("cols")}`;
			badge_el.classList.toggle("ev-jc-agg-badge--hidden", n === 0);
			if (count_el) {
				count_el.textContent = n + " " + __("agg.");
				count_el.classList.toggle("ev-jc-node-count--active", n > 0);
			}
		};

		ag.querySelector(".ev-jc-agg-add").addEventListener("click", (e) => {
			e.stopPropagation();
			this._add_aggregate_row(rows_container, meta_fields, _update);
		});

		_update(); // init badge
	}

	/** Append one Aggregate row to the rows container. */
	_add_aggregate_row(container, meta_fields, on_change, saved = null) {
		const row = document.createElement("div");
		row.className = "ev-jc-agg-row";

		// Include "name" as a COUNT candidate + all meta fields
		const all_fields = [{ fieldname: "name", label: "Name (ID)" }, ...meta_fields];
		const field_opts = all_fields.map(df =>
			`<option value="${frappe.utils.escape_html(df.fieldname)}"
			         ${saved?.field === df.fieldname ? "selected" : ""}>
				${frappe.utils.escape_html(df.label || df.fieldname)}
			</option>`
		).join("");

		const FUNCS    = ["SUM", "COUNT", "AVG", "MIN", "MAX"];
		const func_opts = FUNCS.map(f =>
			`<option value="${f}" ${saved?.func === f ? "selected" : ""}>${f}</option>`
		).join("");

		row.innerHTML = `
			<select class="ev-jc-agg-field form-control form-control-sm">${field_opts}</select>
			<select class="ev-jc-agg-func  form-control form-control-sm">${func_opts}</select>
			<button class="ev-jc-agg-del btn btn-xs" title="${__("Remove")}">×</button>
		`;
		row.querySelector(".ev-jc-agg-del").addEventListener("click", () => {
			row.remove();
			on_change?.();
		});
		container.appendChild(row);
		on_change?.();
	}

	/** Read Aggregate panel state → [{field, func}] or null if no rows. */
	_get_node_aggregate_config(node_id) {
		const ag = this.nodes.get(node_id)?.el?.querySelector(".ev-jc-node-aggregate");
		if (!ag) return null;

		const cols = [...ag.querySelectorAll(".ev-jc-agg-row")].map(r => ({
			field: r.querySelector(".ev-jc-agg-field")?.value || "",
			func:  r.querySelector(".ev-jc-agg-func")?.value  || "SUM",
		})).filter(c => c.field);

		return cols.length ? cols : null;
	}

	/** Restore Aggregate panel from saved config. */
	_restore_aggregate_panel(node_id, agg_cols, meta_fields) {
		if (!agg_cols?.length) return;
		const node_el = this.nodes.get(node_id)?.el;
		if (!node_el) return;
		const ag = node_el.querySelector(".ev-jc-node-aggregate");
		if (!ag) return;

		const rows_container = ag.querySelector(".ev-jc-agg-rows");
		const badge_el       = ag.querySelector(".ev-jc-agg-badge");
		const count_el       = node_el.querySelector(".ev-jc-node-count");

		const _update = () => {
			const n = rows_container.querySelectorAll(".ev-jc-agg-row").length;
			badge_el.textContent = `${n} ${__("cols")}`;
			badge_el.classList.toggle("ev-jc-agg-badge--hidden", n === 0);
			if (count_el) {
				count_el.textContent = n + " " + __("agg.");
				count_el.classList.toggle("ev-jc-node-count--active", n > 0);
			}
		};

		agg_cols.forEach(c => this._add_aggregate_row(rows_container, meta_fields, _update, c));
	}

	/** Set a node as the AI suggestion target — highlights it and refreshes open drawer. */
	_set_ai_target(node_id) {
		this._ai_target_node_id = node_id;
		// Update highlight on all nodes
		this.nodes.forEach((n, nid) => {
			n.el.classList.toggle("ev-jc-node--ai-target", nid === node_id);
		});
		// If the drawer is already open, re-fetch for the new target
		if (this.$stage.find(".ev-jc-ai-drawer").length) {
			this.$stage.find(".ev-jc-ai-drawer").remove();
			this._fetch_and_render_suggestions(false);
		}
	}

	/** Returns the DocType that AI suggestions should be fetched for. */
	_get_ai_doctype() {
		return this.nodes.get(this._ai_target_node_id)?.doctype || this.board.doctype;
	}

	_make_field_row(df, node_id, is_base) {
		const row = document.createElement("div");
		row.className = "ev-jc-field";
		row.dataset.field = df.fieldname;

		// In-port (left) — only on non-base nodes
		if (!is_base) {
			const port_in = document.createElement("span");
			port_in.className = "ev-port ev-port--in";
			port_in.dataset.portDir = "in";
			port_in.dataset.nodeId  = node_id;
			port_in.title = __("Drop connection here");
			row.appendChild(port_in);
		}

		// Label
		const label = document.createElement("span");
		label.className = "ev-jc-field-label";
		label.textContent = df.label || df.fieldname;
		label.title = df.fieldname;
		row.appendChild(label);

		// Out-port (right) — on all nodes
		const port_out = document.createElement("span");
		port_out.className = "ev-port ev-port--out";
		port_out.dataset.portDir = "out";
		port_out.dataset.nodeId  = node_id;
		port_out.title = __("Drag to connect");
		port_out.addEventListener("mousedown", (e) => {
			e.stopPropagation();
			e.preventDefault();
			this._start_wire(e, node_id, df.fieldname);
		});
		row.appendChild(port_out);

		return row;
	}

	// F2 — Add field-select checkboxes to all field rows.
	// @param {Set<string>|null} pre_check — fieldnames to pre-tick (base node use-case)
	_add_field_checkboxes(node_id, container, pre_check = null) {
		const node_el  = this.nodes.get(node_id)?.el || container.closest(".ev-jc-node");
		const count_el = node_el?.querySelector(".ev-jc-node-count");

		const _update_count = () => {
			const node = this.nodes.get(node_id);
			if (!count_el || !node) return;
			const n = node.selected_fields.size;
			count_el.textContent = n + " " + __("selected");
			count_el.classList.toggle("ev-jc-node-count--active", n > 0);
		};

		container.querySelectorAll(".ev-jc-field").forEach(row => {
			if (row.querySelector(".ev-field-select")) return; // idempotent
			const cb = document.createElement("input");
			cb.type      = "checkbox";
			cb.className = "ev-field-select";
			cb.title     = __("Include this field in the grid");

			// Pre-check for base node (currently visible columns)
			if (pre_check?.has(row.dataset.field)) {
				cb.checked = true;
				this.nodes.get(node_id)?.selected_fields.add(row.dataset.field);
				row.classList.add("ev-jc-field--selected");
			}

			cb.addEventListener("change", () => {
				const node  = this.nodes.get(node_id);
				const field = row.dataset.field;
				if (!node) return;
				if (cb.checked) {
					node.selected_fields.add(field);
					row.classList.add("ev-jc-field--selected");
				} else {
					node.selected_fields.delete(field);
					row.classList.remove("ev-jc-field--selected");
				}
				_update_count();
			});

			// Layout: [in-port] [label] [checkbox] [out-port]
			const port_out = row.querySelector(".ev-port--out");
			row.insertBefore(cb, port_out);
		});

		// Init count badge after all rows processed
		_update_count();
	}

	_remove_node(node_id) {
		// Remove all edges connected to this node
		const to_remove = this.edges.filter(
			e => e.src_node_id === node_id || e.tgt_node_id === node_id
		);
		to_remove.forEach(e => this._delete_edge(e));
		this.edges = this.edges.filter(
			e => e.src_node_id !== node_id && e.tgt_node_id !== node_id
		);
		this.nodes.get(node_id)?.el.remove();
		this.nodes.delete(node_id);
		// Persist updated layout (node removed)
		this._auto_save_layout();
	}

	_delete_edge(edge) {
		edge.path_el?.remove();
		edge.badge_el?.remove();
		clearTimeout(edge._remove_timer);
	}

	// ── Node dragging ─────────────────────────────────────────────────────────

	_bind_node_drag(handle_el, node_el) {
		handle_el.addEventListener("pointerdown", (e) => {
			if (e.target.closest(".ev-jc-node-remove") || e.target.closest(".ev-jc-node-ai-target")) return;
			e.preventDefault();
			node_el.setPointerCapture(e.pointerId);
			const origin = {
				mx: e.clientX, my: e.clientY,
				px: node_el.offsetLeft, py: node_el.offsetTop,
			};
			node_el.onpointermove = (e) => {
				node_el.style.left = (origin.px + e.clientX - origin.mx) + "px";
				node_el.style.top  = (origin.py + e.clientY - origin.my) + "px";
				this._render_edges();
			};
			node_el.onpointerup = () => {
				node_el.onpointermove = null;
				node_el.onpointerup   = null;
				// Save updated node positions after drag
				this._auto_save_layout();
			};
		});
	}

	// ── Wire drawing (F4 — document-level events for robustness) ─────────────

	_start_wire(e, node_id, field) {
		const path_el = this._create_svg_path("ev-jc-edge ev-jc-edge--pending");
		this._wire = { src_node_id: node_id, src_field: field, path_el };
		// Use document-level events so the wire tracks the cursor even over child elements
		document.addEventListener("mousemove", this._doc_mousemove);
		document.addEventListener("mouseup",   this._doc_mouseup);

		// V2.4.5 — AI port highlighting: score every visible target node's fields
		const src_dt = this.nodes.get(node_id)?.doctype;
		if (src_dt) {
			[...this.nodes.values()]
				.filter(n => n.id !== node_id)
				.forEach(tgt_node => {
					frappe.call({
						method: "excel_view.api.rank_field_matches",
						args:   { src_doctype: src_dt, src_field: field,
						          tgt_doctype: tgt_node.doctype },
						callback: (r) => {
							if (!this._wire) return; // wire was cancelled
							const scores = r.message || {};
							tgt_node.el.querySelectorAll(".ev-port--in").forEach(port => {
								const fname = port.closest("[data-field]")?.dataset.field;
								if (!fname) return;
								const s = scores[fname] || 0;
								port.dataset.aiScore = s >= 0.75 ? "high" : s >= 0.45 ? "mid" : "";
							});
						},
					});
				});
		}
	}

	_on_doc_mousemove(e) {
		if (!this._wire) return;
		const src    = this._get_port_pos(this._wire.src_node_id, this._wire.src_field, "out");
		const rect   = this.$stage[0].getBoundingClientRect();
		const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		if (src) this._wire.path_el.setAttribute("d", this._bezier(src, cursor));
	}

	_on_doc_mouseup(e) {
		document.removeEventListener("mousemove", this._doc_mousemove);
		document.removeEventListener("mouseup",   this._doc_mouseup);

		// V2.4.5 — clear AI port highlights
		this.$nodes[0]?.querySelectorAll("[data-ai-score]")
			.forEach(el => { el.dataset.aiScore = ""; });

		if (!this._wire) return;

		// Walk the element stack at the drop point — find an in-port
		const els      = document.elementsFromPoint(e.clientX, e.clientY);
		const tgt_port = els.find(el => el.dataset?.portDir === "in");

		if (tgt_port) {
			const tgt_node_el = tgt_port.closest(".ev-jc-node");
			const tgt_node_id = tgt_node_el?.dataset?.id;
			const tgt_field   = tgt_port.closest(".ev-jc-field")?.dataset?.field;

			if (tgt_node_id && tgt_node_id !== this._wire.src_node_id && tgt_field) {
				this._complete_wire(
					this._wire.src_node_id, this._wire.src_field,
					tgt_node_id, tgt_field
				);
				return;
			}
		}

		// Dropped on nothing — cancel wire
		this._wire.path_el.remove();
		this._wire = null;
	}

	_complete_wire(src_node_id, src_field, tgt_node_id, tgt_field) {
		const edge = {
			id:            `edge_${this._edge_ctr++}`,
			src_node_id,
			src_field,
			tgt_node_id,
			tgt_field,
			valid:         null,
			confidence:    null,
			method:        null,
			path_el:       this._wire.path_el,
			badge_el:      null,
			_remove_timer: null,
		};
		this._wire = null;
		this.edges.push(edge);
		this._render_edges();
		this._validate_edge(edge);
	}

	// ── Validation ────────────────────────────────────────────────────────────

	_validate_edge(edge) {
		const src_dt = this.nodes.get(edge.src_node_id)?.doctype;
		const tgt_dt = this.nodes.get(edge.tgt_node_id)?.doctype;
		if (!src_dt || !tgt_dt) return;

		frappe.call({
			method: "excel_view.api.validate_join",
			args: {
				src_doctype: src_dt, src_field: edge.src_field,
				tgt_doctype: tgt_dt, tgt_field: edge.tgt_field,
			},
			freeze: false,
			callback: (r) => {
				const res = r.message;
				// Edge may have been deleted while request was in-flight
				if (!this.edges.find(e => e.id === edge.id)) return;

				edge.valid      = res.valid;
				edge.confidence = res.confidence;
				edge.method     = res.method;
				this._render_edges();

				if (res.valid) {
					this._show_edge_badge(edge, res);
					// Mark connected ports as green
					this._mark_ports_connected(edge);
					// Persist layout so refresh restores this canvas state
					this._auto_save_layout();
				} else if (res.method === "type_mismatch") {
					// V2.4.5 — type incompatibility: instant red alert + immediate removal
					frappe.show_alert({ message: res.message, indicator: "red" }, 5);
					this.edges = this.edges.filter(e => e.id !== edge.id);
					this._delete_edge(edge);
				} else {
					this._show_edge_error(edge, res.message);
					edge._remove_timer = setTimeout(() => {
						this.edges = this.edges.filter(e => e.id !== edge.id);
						this._delete_edge(edge);
					}, 3000);
				}
			},
		});
	}

	_mark_ports_connected(edge) {
		const src_node = this.nodes.get(edge.src_node_id);
		const tgt_node = this.nodes.get(edge.tgt_node_id);
		src_node?.el.querySelector(`[data-field="${edge.src_field}"] .ev-port--out`)
			?.classList.add("ev-port--connected");
		tgt_node?.el.querySelector(`[data-field="${edge.tgt_field}"] .ev-port--in`)
			?.classList.add("ev-port--connected");
	}

	_unmark_ports_connected(edge) {
		const src_node = this.nodes.get(edge.src_node_id);
		const tgt_node = this.nodes.get(edge.tgt_node_id);
		src_node?.el.querySelector(`[data-field="${edge.src_field}"] .ev-port--out`)
			?.classList.remove("ev-port--connected");
		tgt_node?.el.querySelector(`[data-field="${edge.tgt_field}"] .ev-port--in`)
			?.classList.remove("ev-port--connected");
	}

	_show_edge_badge(edge, res) {
		if (edge.badge_el) edge.badge_el.remove();

		const src = this._get_port_pos(edge.src_node_id, edge.src_field, "out");
		const tgt = this._get_port_pos(edge.tgt_node_id, edge.tgt_field, "in");
		if (!src || !tgt) return;

		const mid_x = (src.x + tgt.x) / 2;
		const mid_y = (src.y + tgt.y) / 2;

		const label = res.method === "meta"
			? __("Link field ✓")
			: __("{0}% match ✓", [Math.round(res.confidence * 100)]);

		const badge = document.createElement("div");
		badge.className = "ev-jc-badge";

		// V2.4.5 — grade chip (S / A / B / C / D / F)
		if (res.grade) {
			const gc = document.createElement("span");
			gc.className = `ev-jc-grade ev-jc-grade--${res.grade}`;
			gc.textContent = res.grade;
			badge.appendChild(gc);
		}

		const label_span = document.createElement("span");
		// Enhanced label: "Link ✓ | 1:N | 87% cov"
		const cov_text = (res.coverage != null)
			? ` | ${res.cardinality || ""} | ${Math.round(res.coverage * 100)}% cov`
			: "";
		label_span.textContent = label + cov_text;
		badge.appendChild(label_span);

		// ✕ delink button — remove this edge on click
		const del_btn = document.createElement("button");
		del_btn.className = "ev-jc-badge-remove";
		del_btn.title = __("Remove this connection");
		del_btn.textContent = "✕";
		del_btn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.edges = this.edges.filter(ed => ed.id !== edge.id);
			this._delete_edge(edge);
			this._unmark_ports_connected(edge);
		});
		badge.appendChild(del_btn);

		badge.style.left = mid_x + "px";
		badge.style.top  = (mid_y - 10) + "px";
		this.$stage[0].appendChild(badge);
		edge.badge_el = badge;
	}

	_show_edge_error(edge, message) {
		if (edge.badge_el) edge.badge_el.remove();

		const src = this._get_port_pos(edge.src_node_id, edge.src_field, "out");
		const tgt = this._get_port_pos(edge.tgt_node_id, edge.tgt_field, "in");
		if (!src || !tgt) return;

		const mid_x = (src.x + tgt.x) / 2;
		const mid_y = (src.y + tgt.y) / 2;

		const badge = document.createElement("div");
		badge.className = "ev-jc-badge ev-jc-badge--error";
		badge.textContent = message || __("No match found");
		badge.style.left = mid_x + "px";
		badge.style.top  = (mid_y - 10) + "px";
		this.$stage[0].appendChild(badge);
		edge.badge_el = badge;
	}

	// ── Edge rendering ────────────────────────────────────────────────────────

	_render_edges() {
		this.edges.forEach(edge => {
			const src = this._get_port_pos(edge.src_node_id, edge.src_field, "out");
			const tgt = this._get_port_pos(edge.tgt_node_id, edge.tgt_field, "in");
			if (!src || !tgt) return;

			edge.path_el.setAttribute("d", this._bezier(src, tgt));

			if (edge.valid === true) {
				edge.path_el.style.stroke          = "#1d6f42";
				edge.path_el.style.strokeDasharray = "none";
			} else if (edge.valid === false) {
				edge.path_el.style.stroke          = "#e03e3e";
				edge.path_el.style.strokeDasharray = "5,4";
			} else {
				// Pending validation
				edge.path_el.style.stroke          = "#aaa";
				edge.path_el.style.strokeDasharray = "5,4";
			}

			// Reposition confidence badge when nodes are dragged
			if (edge.badge_el) {
				const mid_x = (src.x + tgt.x) / 2;
				const mid_y = (src.y + tgt.y) / 2;
				edge.badge_el.style.left = mid_x + "px";
				edge.badge_el.style.top  = (mid_y - 10) + "px";
			}
		});
	}

	_create_svg_path(class_name) {
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("class", class_name);
		path.style.fill        = "none";
		path.style.strokeWidth = "2";
		this.$svg.appendChild(path);
		return path;
	}

	_get_port_pos(node_id, field, dir) {
		const node = this.nodes.get(node_id);
		if (!node) return null;
		const cls      = dir === "out" ? ".ev-port--out" : ".ev-port--in";
		const field_el = node.el.querySelector(`[data-field="${field}"]`);
		const port_el  = field_el?.querySelector(cls);
		if (!port_el) return null;

		const stage_rect = this.$stage[0].getBoundingClientRect();
		const r          = port_el.getBoundingClientRect();
		return {
			x: r.left + r.width  / 2 - stage_rect.left,
			y: r.top  + r.height / 2 - stage_rect.top,
		};
	}

	_bezier(p1, p2) {
		const cx = (p1.x + p2.x) / 2;
		return `M ${p1.x} ${p1.y} C ${cx} ${p1.y}, ${cx} ${p2.y}, ${p2.x} ${p2.y}`;
	}

	// ── Preview ───────────────────────────────────────────────────────────────

	_show_preview() {
		const cfg = this.get_join_config();
		const valid_edges = cfg.edges.filter(e => e.selected_fields?.length);
		if (!cfg.edges.length) {
			frappe.show_alert({
				message: __("Draw a connection first: drag ○ from one field to ○ on another DocType's field"),
				indicator: "orange",
			}, 5);
			return;
		}
		if (!valid_edges.length) {
			frappe.show_alert({
				message: __("Check at least one field on the joined DocType to preview"),
				indicator: "orange",
			}, 4);
			return;
		}

		// For preview: include base_names so we find 5 rows with actual join data
		const preview_cfg = {
			...cfg,
			base_names: (this.board.list_view.data || []).map(d => d.name),
		};
		frappe.call({
			method: "excel_view.api.get_joined_data",
			args: {
				base_doctype: this.board.doctype,
				join_config:  JSON.stringify(preview_cfg),
				limit:        5,
			},
			freeze: false,
			callback: (r) => this._render_preview_table(r.message || [], cfg),
		});
	}

	// Helper: get human-readable label for a field from Frappe meta
	_field_label(doctype, fieldname) {
		if (fieldname === "name") return __("ID");
		const df = frappe.get_meta(doctype)?.fields?.find(f => f.fieldname === fieldname);
		return df?.label || fieldname;
	}

	_render_preview_table(rows, cfg) {
		// Build column list with proper human-readable labels
		const cols = [{ key: "name", label: __("ID"), doctype: this.board.doctype }];
		cfg.edges.forEach(edge => {
			const tgt_node = cfg.nodes.find(n => n.id === edge.tgt_node_id);
			if (!tgt_node) return;
			(edge.selected_fields || []).forEach(f => {
				cols.push({
					key:     `${tgt_node.doctype}__${f}`,
					label:   this._field_label(tgt_node.doctype, f),
					doctype: tgt_node.doctype,
					group:   tgt_node.doctype,
				});
			});
		});

		// Group header row (doctype names spanning columns)
		let group_header_html = `<th rowspan="2" class="ev-prev-th ev-prev-th--id">${__("ID")}</th>`;
		// Count how many columns per doctype (skip the name/ID column)
		const groups = {};
		cols.slice(1).forEach(c => { groups[c.group] = (groups[c.group] || 0) + 1; });
		Object.entries(groups).forEach(([doctype, count]) => {
			group_header_html += `<th colspan="${count}" class="ev-prev-th ev-prev-th--group">${frappe.utils.escape_html(doctype)}</th>`;
		});

		// Field label row
		const field_header_html = cols.slice(1).map(c =>
			`<th class="ev-prev-th ev-prev-th--field">${frappe.utils.escape_html(c.label)}</th>`
		).join("");

		// Data rows — green highlight for matched rows, muted for unmatched
		const rows_html = rows.map((row, i) => {
			const has_join = cols.slice(1).some(c => row[c.key] !== null && row[c.key] !== undefined && row[c.key] !== "");
			const row_cls  = has_join ? (i % 2 === 0 ? "ev-prev-row" : "ev-prev-row ev-prev-row--alt")
			                          : "ev-prev-row ev-prev-row--empty";
			return `<tr class="${row_cls}">${cols.map(c => {
				const val = row[c.key];
				const display = (val !== null && val !== undefined && val !== "") ? String(val) : "";
				return `<td class="ev-prev-td${display ? "" : " ev-prev-td--null"}">${
					display ? frappe.utils.escape_html(display) : `<span class="ev-prev-null">—</span>`
				}</td>`;
			}).join("")}</tr>`;
		}).join("");

		const html = `
			<style>
				.ev-preview-wrap { overflow:auto; max-height:55vh; border:1px solid #e0e0e0; border-radius:4px; }
				.ev-prev-table { border-collapse:collapse; min-width:100%; font-size:12px; font-family:inherit; }
				.ev-prev-th { padding:5px 12px; border:1px solid rgba(255,255,255,0.15); white-space:nowrap; font-weight:600; }
				.ev-prev-th--id { background:#1a4c97; color:#fff; font-size:11px; }
				.ev-prev-th--group { background:#1d6f42; color:#fff; text-align:center; font-size:11px; letter-spacing:.3px; }
				.ev-prev-th--field { background:#2d8a56; color:#fff; font-weight:400; font-size:11px; }
				thead { position:sticky; top:0; z-index:2; }
				.ev-prev-td { padding:5px 12px; border:1px solid #e8e8e8; white-space:nowrap; max-width:220px; overflow:hidden; text-overflow:ellipsis; font-size:12px; }
				.ev-prev-td--null { color:#bbb; }
				.ev-prev-null { font-style:italic; }
				.ev-prev-row { background:#fff; }
				.ev-prev-row--alt { background:#f4faf7; }
				.ev-prev-row--empty { background:#fafafa; color:#aaa; }
				.ev-prev-row:hover td { background:rgba(29,111,66,.05) !important; }
			</style>
			<div class="ev-preview-wrap">
				<table class="ev-prev-table">
					<thead>
						<tr><th class="ev-prev-th ev-prev-th--id" rowspan="2">${__("ID")}</th>${
							Object.entries(groups).map(([dt, count]) =>
								`<th colspan="${count}" class="ev-prev-th ev-prev-th--group">${frappe.utils.escape_html(dt)}</th>`
							).join("")
						}</tr>
						<tr>${field_header_html}</tr>
					</thead>
					<tbody>${rows_html}</tbody>
				</table>
			</div>`;

		const d = new frappe.ui.Dialog({
			title: __("Preview — {0} rows", [rows.length]),
			fields: [{ fieldtype: "HTML", options: html }],
			primary_action_label: __("Close"),
			primary_action() { d.hide(); },
		});
		d.$wrapper.find(".modal-dialog").css("max-width", "800px");
		d.show();
	}

	// ── Apply ─────────────────────────────────────────────────────────────────

	_apply() {
		const cfg = this.get_join_config();
		const valid_edges = cfg.edges.filter(e => e.selected_fields?.length);

		if (!cfg.edges.length) {
			frappe.show_alert({
				message: __("No connection yet. Drag ○ from one field to ○ on another DocType to join."),
				indicator: "orange",
			}, 5);
			return;
		}
		if (!valid_edges.length) {
			frappe.show_alert({
				message: __("Check at least one field on the joined DocType to include in the grid"),
				indicator: "orange",
			}, 4);
			return;
		}

		// Pass all currently-loaded doc names so the SQL filters to exactly what's
		// in the grid (root-node data drives the result — not DB order / LIMIT drift)
		const loaded_data  = this.board.list_view.data || [];
		const apply_cfg    = {
			...cfg,
			base_names: loaded_data.map(d => d.name),
		};
		frappe.call({
			method:         "excel_view.api.get_joined_data",
			args: {
				base_doctype: this.board.doctype,
				join_config:  JSON.stringify(apply_cfg),
				limit:        loaded_data.length + 100, // generous buffer
			},
			freeze:         true,
			freeze_message: __("Joining data…"),
			callback: (r) => {
				this.board._apply_join_result(r.message || [], cfg);
				// Persist canvas layout to user_settings so it's restored on next open
				this._save_to_user_settings(cfg);
				this.close();
				// Prompt to save this join as a named View so it appears in "Views"
				this._prompt_save_view(cfg);
			},
		});
	}

	/**
	 * After a successful Apply, prompt the user to name and save this join
	 * as an Excel Workbook entry visible in the "Views" list.
	 * Cancelling skips the save — the join is still applied in the grid.
	 *
	 * @param {Object} cfg - join_config (without base_names)
	 */
	_prompt_save_view(cfg) {
		// Build a sensible default name: "User + Employee" etc.
		const joined = cfg.nodes
			.filter(n => n.doctype !== this.board.doctype)
			.map(n => n.doctype)
			.join(", ");
		const default_title = joined
			? `${this.board.doctype} + ${joined}`
			: this.board.doctype;

		frappe.prompt(
			[
				{
					fieldtype: "Data",
					fieldname: "title",
					label:     __("View Name"),
					default:   default_title,
					reqd:      1,
				},
				{
					fieldtype: "Check",
					fieldname: "is_public",
					label:     __("Share with everyone"),
					default:   0,
				},
			],
			({ title, is_public }) => {
				this.board.workbook_manager.save_titled(title, is_public);
			},
			__("Save as View"),
			__("Save"),
		);
	}

	// ── Serialisation ─────────────────────────────────────────────────────────

	/**
	 * Serialise canvas to join_config.
	 * selected_fields is now read from the target node (per-node, F2).
	 * Only edges where valid===true AND target node has ≥1 selected field are included.
	 * node_positions is included for visual restoration when canvas is reopened.
	 */
	get_join_config() {
		// Base node selected_fields → controls which base columns to show after Apply
		const base_node = [...this.nodes.values()].find(n => n.doctype === this.board.doctype);
		const base_selected = base_node?.selected_fields.size
			? [...base_node.selected_fields]
			: null; // null = keep current HOT columns unchanged

		// Capture current node positions for layout restoration
		const node_positions = {};
		this.nodes.forEach((node, id) => {
			node_positions[id] = {
				x: node.el.offsetLeft,
				y: node.el.offsetTop,
			};
		});

		return {
			base_doctype:         this.board.doctype,
			base_selected_fields: base_selected,
			node_positions,
			nodes: [...this.nodes.values()].map(n => {
				const base_node_cfg = { id: n.id, doctype: n.doctype };
				if (n.doctype !== this.board.doctype) {
					// CT nodes carry aggregate_cols; regular nodes carry transform config
					const agg = this._get_node_aggregate_config(n.id);
					if (agg) {
						base_node_cfg.aggregate_cols = agg;
					} else {
						const tf = this._get_node_transform_config(n.id);
						if (tf.row_filter.length || tf.computed_cols.length) {
							base_node_cfg.row_filter    = tf.row_filter;
							base_node_cfg.computed_cols = tf.computed_cols;
						}
					}
				}
				return base_node_cfg;
			}),
			edges: this.edges
				.filter(e => e.valid === true)
				.map(e => {
					const tgt_node = this.nodes.get(e.tgt_node_id);
					// CT aggregate nodes: selected_fields = agg field names
					// (used by preview check and workbook serialisation; SQL ignores it)
					const agg = this._get_node_aggregate_config(e.tgt_node_id);
					const selected_fields = agg
						? agg.map(c => c.field)
						: [...(tgt_node?.selected_fields || [])];
					return {
						id:              e.id,
						src_node_id:     e.src_node_id,
						src_field:       e.src_field,
						tgt_node_id:     e.tgt_node_id,
						tgt_field:       e.tgt_field,
						selected_fields,
						confidence:      e.confidence,
						method:          e.method,
					};
				}),
		};
	}

	// ── Persistence — user_settings ───────────────────────────────────────────

	/**
	 * Save current canvas layout to user_settings for this DocType.
	 * Called automatically after every successful "Apply".
	 * Stored without base_names (those are dynamic, rebuilt on each apply).
	 *
	 * @param {Object} cfg - join_config from get_join_config()
	 */
	_save_to_user_settings(cfg) {
		// Omit base_names (if present) — they change every session
		const { base_names: _, ...save_cfg } = cfg;
		frappe.model.user_settings.save(
			this.board.doctype,
			"excel_join_config",
			save_cfg,
		);
	}

	/**
	 * Auto-save canvas layout to user_settings without requiring Apply.
	 * Called after every structural change (valid edge, node remove, node drag).
	 * Preserves nodes + positions + aggregate/transform config so refresh
	 * restores the exact canvas the user last worked on.
	 */
	_auto_save_layout() {
		const has_non_base = [...this.nodes.values()]
			.some(n => n.doctype !== this.board.doctype);
		if (has_non_base) {
			// Save current canvas (nodes + positions + edges + agg/transform config)
			this._save_to_user_settings(this.get_join_config());
		} else {
			// All non-base nodes removed — explicitly clear so refresh starts clean
			frappe.model.user_settings.save(
				this.board.doctype,
				"excel_join_config",
				null,
			);
		}
	}

	/**
	 * Check user_settings for a previously saved canvas layout and restore it.
	 * Called from open() after the base node is rendered.
	 */
	_restore_from_user_settings() {
		const saved = frappe.get_user_settings(this.board.doctype)?.excel_join_config;
		if (!saved?.nodes?.length) return;

		// Only restore if there are non-base nodes or edges to show
		const has_non_base = saved.nodes.some(n => n.doctype !== this.board.doctype);
		const has_edges    = saved.edges?.length > 0;
		if (!has_non_base && !has_edges) return;

		this._restore_from_config(saved);
	}

	/**
	 * Restore a saved canvas state (nodes, positions, edges, selected fields).
	 * Edges are re-validated so stale connections are auto-removed if data changed.
	 *
	 * @param {Object} cfg - join_config (with node_positions)
	 */
	_restore_from_config(cfg) {
		// Maps cfg node_id → newly created canvas node_id
		const node_id_map = {};

		// ── Restore base node mapping + position ──────────────────────────
		const base_canvas = [...this.nodes.values()].find(n => n.doctype === this.board.doctype);
		const cfg_base    = (cfg.nodes || []).find(n => n.doctype === this.board.doctype);
		if (base_canvas && cfg_base) {
			node_id_map[cfg_base.id] = base_canvas.id;
			// Restore saved position
			const pos = cfg.node_positions?.[cfg_base.id];
			if (pos) {
				base_canvas.el.style.left = pos.x + "px";
				base_canvas.el.style.top  = pos.y + "px";
			}
			// Restore base node selected_fields (checkboxes)
			if (cfg.base_selected_fields?.length) {
				const fields_div = base_canvas.el.querySelector(".ev-jc-node-fields");
				cfg.base_selected_fields.forEach(f => {
					const cb = fields_div?.querySelector(`[data-field="${f}"] .ev-field-select`);
					if (cb && !cb.checked) {
						cb.checked = true;
						cb.dispatchEvent(new Event("change"));
					}
				});
			}
		}

		// ── Restore non-base nodes ────────────────────────────────────────
		const non_base = (cfg.nodes || []).filter(n => n.doctype !== this.board.doctype);
		if (!non_base.length) return;

		let loaded_count = 0;

		const _maybe_restore_edges = () => {
			if (loaded_count < non_base.length) return;
			// All nodes rendered — now restore edges
			(cfg.edges || []).forEach(edge => {
				const src_id = node_id_map[edge.src_node_id];
				const tgt_id = node_id_map[edge.tgt_node_id];
				if (!src_id || !tgt_id) return;

				const path_el = this._create_svg_path("ev-jc-edge ev-jc-edge--pending");
				const new_edge = {
					id:          `edge_${this._edge_ctr++}`,
					src_node_id: src_id,
					src_field:   edge.src_field,
					tgt_node_id: tgt_id,
					tgt_field:   edge.tgt_field,
					valid:       null,
					confidence:  null,
					method:      null,
					path_el,
					badge_el:    null,
					_remove_timer: null,
				};
				this.edges.push(new_edge);
				// Re-validate: data may have changed since last session
				this._validate_edge(new_edge);
			});
			this._render_edges();
		};

		non_base.forEach(cfg_node => {
			frappe.model.with_doctype(cfg_node.doctype, () => {
				const new_id = this._add_node(cfg_node.doctype, { base: false });
				node_id_map[cfg_node.id] = new_id;

				// Restore position
				const pos = cfg.node_positions?.[cfg_node.id];
				if (pos) {
					const node_el = this.nodes.get(new_id)?.el;
					if (node_el) {
						node_el.style.left = pos.x + "px";
						node_el.style.top  = pos.y + "px";
					}
				}

				// Restore selected_fields for this node (from edges targeting it)
				const canvas_node = this.nodes.get(new_id);
				if (canvas_node) {
					const fields_div = canvas_node.el.querySelector(".ev-jc-node-fields");
					(cfg.edges || [])
						.filter(e => e.tgt_node_id === cfg_node.id)
						.forEach(edge => {
							(edge.selected_fields || []).forEach(f => {
								const cb = fields_div?.querySelector(
									`[data-field="${f}"] .ev-field-select`
								);
								if (cb && !cb.checked) {
									cb.checked = true;
									cb.dispatchEvent(new Event("change"));
								}
							});
						});

					// Restore Aggregate panel (CT) or Transform panel (regular) — V2.5+
					if (cfg_node.aggregate_cols?.length || cfg_node.row_filter?.length || cfg_node.computed_cols?.length) {
						const meta    = frappe.get_meta(cfg_node.doctype);
						const is_ct   = !!meta?.istable;
						const SKIP    = new Set([
							"Column Break", "Section Break", "Tab Break", "Fold",
							"Heading", "HTML", "Custom HTML", "Table", "Table MultiSelect", "Password",
						]);
						const CHILD_SYS = new Set(["parent", "parenttype", "parentfield", "idx"]);
						const mfs = (meta?.fields || []).filter(
							df => !SKIP.has(df.fieldtype) && !df.is_virtual && df.fieldname !== "name"
								&& !(is_ct && CHILD_SYS.has(df.fieldname))
						);
						if (cfg_node.aggregate_cols?.length) {
							this._restore_aggregate_panel(new_id, cfg_node.aggregate_cols, mfs);
						} else {
							this._restore_transform_panel(new_id, {
								row_filter:    cfg_node.row_filter    || [],
								computed_cols: cfg_node.computed_cols || [],
							}, mfs);
						}
					}
				}


				loaded_count++;
				_maybe_restore_edges();
			});
		});
	}

	// ── V2.4.5 AI features ────────────────────────────────────────────────────

	/**
	 * Toggle the AI Discover suggestion panel.
	 * First click → spinner → API call → chips panel below header.
	 * Second click → panel collapses.
	 */
	_toggle_ai_discover() {
		// Toggle: close if already open
		if (this.$stage.find(".ev-jc-ai-drawer").length) {
			this.$stage.find(".ev-jc-ai-drawer").remove();
			this.$overlay.find(".ev-jc-ai-btn").removeClass("ev-jc-btn--active");
			return;
		}
		this._fetch_and_render_suggestions(false);
	}

	/** Shared fetch helper used by toggle + refresh button + node target change. */
	_fetch_and_render_suggestions(force_refresh) {
		const $btn = this.$overlay.find(".ev-jc-ai-btn");
		$btn.prop("disabled", true).html(`⏳ ${__("Analyzing\u2026")}`);
		frappe.call({
			method: "excel_view.api.suggest_joins",
			args:   { base_doctype: this._get_ai_doctype(), force_refresh: force_refresh ? 1 : 0 },
			callback: (r) => {
				$btn.prop("disabled", false).html(`✨ ${__("AI")}`).addClass("ev-jc-btn--active");
				const suggestions = r.message || [];
				if (!suggestions.length) {
					frappe.show_alert({ message: __("No join candidates found"), indicator: "orange" });
					return;
				}
				this._render_suggest_panel(suggestions);
			},
		});
	}

	/**
	 * Render a right-side drawer with one card per suggestion.
	 * Drawer appends inside .ev-jc-stage (position:relative) so it overlays
	 * the canvas without pushing the header.
	 */
	_render_suggest_panel(suggestions) {
		this.$stage.find(".ev-jc-ai-drawer").remove();

		// Which DocTypes are already on the canvas?
		const added = new Set([...this.nodes.values()].map(n => n.doctype));

		const make_card = (s) => {
			const pct         = Math.round(s.score * 100);
			const is_meta     = s.method === "meta";
			const is_ct       = s.method === "child_table";
			const is_added    = added.has(s.doctype);
			const via         = s.src_field !== "name"
				? `${s.src_field} → ${s.tgt_field}`
				: `via ${s.tgt_field}`;
			const stripe_cls  = is_ct ? "child_table" : (is_meta ? "meta" : "ml");
			return `
				<div class="ev-jc-ai-card${is_added ? " ev-jc-card--added" : ""}"
				     data-doctype="${frappe.utils.escape_html(s.doctype)}">
					<div class="ev-jc-card-stripe ev-jc-card-stripe--${stripe_cls}"></div>
					<div class="ev-jc-card-body">
						<div class="ev-jc-card-name"
						     title="${frappe.utils.escape_html(s.doctype)}">
							${frappe.utils.escape_html(s.doctype)}
							${is_ct ? `<span class="ev-jc-ct-badge ev-jc-ct-badge--card" title="${__("Child Table")}">CT</span>` : ""}
						</div>
						<div class="ev-jc-card-via"
						     title="${frappe.utils.escape_html(s.reason)}">
							${frappe.utils.escape_html(via)}
						</div>
						<div class="ev-jc-card-bar-wrap">
							<div class="ev-jc-card-bar${is_meta || is_ct ? "" : " ev-jc-card-bar--ml"}"
							     style="width:${pct}%"></div>
						</div>
					</div>
					<div class="ev-jc-card-actions">
						<span class="ev-jc-card-pct">${pct}%</span>
						${is_added
							? `<span class="ev-jc-card-check" title="${__("Already on canvas")}">✓</span>`
							: `<button class="btn btn-xs btn-primary ev-jc-card-add">${__("+ Add")}</button>`}
					</div>
				</div>`;
		};

		const meta_count  = suggestions.filter(s => s.method === "meta").length;
		const ct_count    = suggestions.filter(s => s.method === "child_table").length;
		const ml_count    = suggestions.filter(s => s.method === "ml").length;
		const count_label = [
			meta_count ? `${meta_count} Link` : "",
			ct_count   ? `${ct_count} CT`     : "",
			ml_count   ? `${ml_count} ML`     : "",
		].filter(Boolean).join(" · ") || "0";
		const for_dt      = this._get_ai_doctype();

		const $drawer = $(`
			<div class="ev-jc-ai-drawer">
				<div class="ev-jc-ai-drawer-head">
					<div class="ev-jc-ai-drawer-title">
						<span>✨ ${__("AI Suggestions")}</span>
						<span class="ev-jc-ai-drawer-sub">${frappe.utils.escape_html(count_label)}</span>
					</div>
					<div class="ev-jc-ai-drawer-head-actions">
						<button class="btn btn-xs btn-default ev-jc-ai-drawer-refresh"
						        title="${__("Refresh — bust 5-min schema cache")}">↻</button>
						<button class="btn btn-xs btn-default ev-jc-ai-drawer-close"
						        title="${__("Close")}">✕</button>
					</div>
				</div>
				<div class="ev-jc-ai-drawer-for">
					${__("for")}:
					<strong>${frappe.utils.escape_html(for_dt)}</strong>
					<span class="ev-jc-ai-drawer-for-hint">
						${__("(click ✨ on any node to change)")}
					</span>
				</div>
				<div class="ev-jc-ai-drawer-search-wrap">
					<input class="ev-jc-ai-drawer-search form-control form-control-sm"
					       type="text" placeholder="${__("Filter…")}">
				</div>
				<div class="ev-jc-ai-drawer-body">
					${suggestions.map(make_card).join("")}
				</div>
			</div>
		`);

		// Close button
		$drawer.find(".ev-jc-ai-drawer-close").on("click", () => {
			$drawer.remove();
			this.$overlay.find(".ev-jc-ai-btn").removeClass("ev-jc-btn--active");
		});

		// Refresh button — bust Redis cache + re-fetch
		$drawer.find(".ev-jc-ai-drawer-refresh").on("click", () => {
			$drawer.remove();
			this._fetch_and_render_suggestions(true);
		});

		// Real-time filter
		$drawer.find(".ev-jc-ai-drawer-search").on("input", function () {
			const q = this.value.toLowerCase();
			$drawer.find(".ev-jc-ai-card").each(function () {
				$(this).toggle(!q || $(this).data("doctype").toLowerCase().includes(q));
			});
		});

		// "+ Add" button on each card
		$drawer.on("click", ".ev-jc-card-add", (e) => {
			const $card = $(e.currentTarget).closest(".ev-jc-ai-card");
			const dt    = $card.data("doctype");
			const s     = suggestions.find(x => x.doctype === dt);
			if (!s) return;
			// Mark card as added inline — drawer stays open so user can add more
			$card.addClass("ev-jc-card--added");
			$(e.currentTarget).replaceWith(
				`<span class="ev-jc-card-check" title="${__("Added")}">✓</span>`
			);
			added.add(dt);
			this._add_suggested_node(s);
		});

		this.$stage.append($drawer);
	}

	/**
	 * Auto-add a DocType node and draw a validated edge from an AI suggestion.
	 * @param {Object} s - {doctype, src_field, tgt_field}
	 */
	_add_suggested_node(s) {
		frappe.model.with_doctype(s.doctype, () => {
			const new_id   = this._add_node(s.doctype, { base: false });
			// Use the AI-target node as source; fall back to base node
			const src_node = this.nodes.get(this._ai_target_node_id)
				|| [...this.nodes.values()].find(n => n.doctype === this.board.doctype);
			if (!src_node) return;
			// Defer one tick so the node DOM is fully painted before port positioning
			setTimeout(() => {
				const path_el = this._create_svg_path("ev-jc-edge ev-jc-edge--pending");
				const edge = {
					id:            `edge_${this._edge_ctr++}`,
					src_node_id:   src_node.id,
					src_field:     s.src_field,
					tgt_node_id:   new_id,
					tgt_field:     s.tgt_field,
					valid:         null,
					confidence:    null,
					method:        null,
					path_el,
					badge_el:      null,
					_remove_timer: null,
				};
				this.edges.push(edge);
				this._validate_edge(edge);
			}, 50);
		});
	}

	/**
	 * Prompt for a target DocType, then call find_join_path and auto-build
	 * all intermediate nodes + edges on the canvas.
	 */
	_run_find_path() {
		frappe.prompt(
			[{
				label:     __("Target DocType"),
				fieldname: "target",
				fieldtype: "Link",
				options:   "DocType",
				reqd:      1,
			}],
			(vals) => {
				if (vals.target === this.board.doctype) {
					frappe.show_alert({ message: __("Target must differ from base DocType"), indicator: "orange" });
					return;
				}
				frappe.call({
					method: "excel_view.api.find_join_path",
					args:   { src_doctype: this.board.doctype, tgt_doctype: vals.target },
					callback: (r) => {
						const hops = r.message || [];
						if (!hops.length) {
							frappe.show_alert({
								message:   __("No link path found between {0} and {1}", [this.board.doctype, vals.target]),
								indicator: "red",
							}, 4);
							return;
						}
						this._build_path_chain(hops);
					},
				});
			},
			__("Find Join Path"),
			__("Find Path")
		);
	}

	/**
	 * Add missing nodes and wire all hops from find_join_path.
	 * @param {Array} hops - [{from_doctype, to_doctype, src_field, tgt_field}]
	 */
	_build_path_chain(hops) {
		const node_id_by_dt = Object.fromEntries(
			[...this.nodes.values()].map(n => [n.doctype, n.id])
		);
		const to_add = hops.map(h => h.to_doctype).filter(dt => !node_id_by_dt[dt]);
		let loaded = 0;

		const _try_wire = () => {
			if (loaded < to_add.length) return;
			hops.forEach(hop => {
				const src_id = node_id_by_dt[hop.from_doctype];
				const tgt_id = node_id_by_dt[hop.to_doctype];
				if (!src_id || !tgt_id) return;
				// Skip duplicate edges
				const dup = this.edges.some(e =>
					e.src_node_id === src_id && e.src_field === hop.src_field &&
					e.tgt_node_id === tgt_id && e.tgt_field === hop.tgt_field
				);
				if (dup) return;
				const path_el = this._create_svg_path("ev-jc-edge ev-jc-edge--pending");
				const edge = {
					id:            `edge_${this._edge_ctr++}`,
					src_node_id:   src_id, src_field: hop.src_field,
					tgt_node_id:   tgt_id, tgt_field: hop.tgt_field,
					valid: null, confidence: null, method: null,
					path_el, badge_el: null, _remove_timer: null,
				};
				this.edges.push(edge);
				this._validate_edge(edge);
			});
		};

		if (!to_add.length) { _try_wire(); return; }
		to_add.forEach(dt => {
			frappe.model.with_doctype(dt, () => {
				const new_id = this._add_node(dt, { base: false });
				node_id_by_dt[dt] = new_id;
				loaded++;
				_try_wire();
			});
		});
	}

	/** Call mine_join_patterns API and show rules in a dialog. */
	_run_pattern_mining() {
		const cfg = this.get_join_config();
		if (!cfg.edges.filter(e => e.valid).length) {
			frappe.show_alert({ message: __("Apply a join first before discovering patterns"), indicator: "orange" });
			return;
		}
		const $btn = this.$overlay.find(".ev-jc-patterns-btn");
		$btn.prop("disabled", true).html(`⏳ ${__("Mining\u2026")}`);

		frappe.call({
			method: "excel_view.api.mine_join_patterns",
			args: {
				base_doctype:   this.board.doctype,
				join_config:    JSON.stringify(cfg),
				min_support:    0.1,
				min_confidence: 0.5,
			},
			callback: (r) => {
				$btn.prop("disabled", false).html(`📊 ${__("Patterns")}`);
				const rules = r.message || [];
				if (!rules.length) {
					frappe.show_alert({
						message:   __("No strong patterns found — add more records or check field selection"),
						indicator: "blue",
					}, 4);
					return;
				}
				this._show_patterns_dialog(rules);
			},
		});
	}

	// ── V2.5 AI Analysis Panel ────────────────────────────────────────────────

	/**
	 * Open the AI Analysis panel (Anomaly Detection + Clustering).
	 * Right-side drawer appended to this.$stage, same pattern as AI Discover drawer.
	 * Uses current board.list_view.data (post-Apply joined rows).
	 */
	_open_analyze_panel() {
		const data = this.board.list_view.data || [];
		if (!data.length) {
			frappe.show_alert({ message: __("Apply a join first to populate data for analysis"), indicator: "orange" }, 4);
			return;
		}

		// Remove any existing panel
		this.$stage.find(".ev-jc-analyze-drawer").remove();

		// Detect numeric fields from the first row
		const sample = data[0] || {};
		const numeric_fields = Object.keys(sample).filter(k => {
			if (k.startsWith("_")) return false;
			const v = sample[k];
			return typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v)));
		});

		if (!numeric_fields.length) {
			frappe.show_alert({ message: __("No numeric columns found in joined data for analysis"), indicator: "orange" }, 4);
			return;
		}

		const field_opts = numeric_fields.map(f =>
			`<label class="ev-ai-field-cb">
				<input type="checkbox" value="${frappe.utils.escape_html(f)}" checked>
				${frappe.utils.escape_html(f)}
			</label>`
		).join("");

		const drawer = document.createElement("div");
		drawer.className = "ev-jc-analyze-drawer";
		drawer.innerHTML = `
			<div class="ev-jc-analyze-header">
				<span>🤖 ${__("AI Analysis")}</span>
				<button class="ev-jc-analyze-close btn btn-xs">✕</button>
			</div>
			<div class="ev-jc-analyze-tabs">
				<button class="ev-jc-atab active" data-tab="anomaly">${__("Anomaly Detection")}</button>
				<button class="ev-jc-atab"         data-tab="cluster">${__("Clustering")}</button>
			</div>

			<div class="ev-jc-atab-body" data-tab="anomaly">
				<div class="ev-ai-label">${__("Numeric columns to analyze:")}</div>
				<div class="ev-ai-fields">${field_opts}</div>
				<div class="ev-ai-label">${__("Contamination (anomaly fraction):")}</div>
				<input type="range" class="ev-ai-contamination" min="5" max="30" value="10" step="1">
				<span class="ev-ai-contam-val">10%</span>
				<button class="btn btn-sm btn-primary ev-ai-run-anomaly" style="margin-top:8px;width:100%">
					${__("Run Anomaly Detection")}
				</button>
				<div class="ev-ai-result-anomaly"></div>
			</div>

			<div class="ev-jc-atab-body" data-tab="cluster" style="display:none">
				<div class="ev-ai-label">${__("Numeric columns to analyze:")}</div>
				<div class="ev-ai-fields">${field_opts.replace(/ checked/g, "")}</div>
				<div class="ev-ai-label">${__("Number of clusters:")}</div>
				<select class="ev-ai-k-select form-control form-control-sm" style="width:auto">
					<option value="0">${__("Auto (silhouette)")}</option>
					${[2,3,4,5,6].map(k => `<option value="${k}">${k}</option>`).join("")}
				</select>
				<button class="btn btn-sm btn-primary ev-ai-run-cluster" style="margin-top:8px;width:100%">
					${__("Run Clustering")}
				</button>
				<div class="ev-ai-result-cluster"></div>
			</div>
		`;
		this.$stage[0].appendChild(drawer);

		// Close button
		drawer.querySelector(".ev-jc-analyze-close").addEventListener("click", () => {
			drawer.remove();
		});

		// Tab switching
		drawer.querySelectorAll(".ev-jc-atab").forEach(btn => {
			btn.addEventListener("click", () => {
				drawer.querySelectorAll(".ev-jc-atab").forEach(b => b.classList.remove("active"));
				btn.classList.add("active");
				const tab = btn.dataset.tab;
				drawer.querySelectorAll(".ev-jc-atab-body").forEach(body => {
					body.style.display = body.dataset.tab === tab ? "block" : "none";
				});
			});
		});

		// Contamination slider label
		const slider = drawer.querySelector(".ev-ai-contamination");
		const label  = drawer.querySelector(".ev-ai-contam-val");
		slider.addEventListener("input", () => { label.textContent = `${slider.value}%`; });

		// ── Run Anomaly Detection ──────────────────────────────────────────
		drawer.querySelector(".ev-ai-run-anomaly").addEventListener("click", () => {
			const selected = [...drawer.querySelectorAll(".ev-jc-atab-body[data-tab=anomaly] .ev-ai-field-cb input:checked")]
				.map(cb => cb.value);
			if (!selected.length) {
				frappe.show_alert({ message: __("Select at least one numeric column"), indicator: "orange" }, 3);
				return;
			}
			const contamination = parseInt(slider.value) / 100;
			const result_el = drawer.querySelector(".ev-ai-result-anomaly");
			result_el.innerHTML = `<div class="ev-ai-spinner">⏳ ${__("Running…")}</div>`;

			frappe.call({
				method: "excel_view.api.detect_anomalies",
				args: {
					rows:             JSON.stringify(data),
					numeric_fields:   JSON.stringify(selected),
					contamination,
				},
				callback: (r) => {
					const enriched = r.message || [];
					if (!enriched.length) {
						result_el.innerHTML = `<div class="ev-ai-info">${__("Not enough data (min 5 rows)")}</div>`;
						return;
					}
					// Inject anomaly columns into board data
					enriched.forEach((row, i) => {
						if (data[i]) {
							data[i]._anomaly_score = row._anomaly_score;
							data[i]._is_anomaly    = row._is_anomaly;
						}
					});
					this.board.hot?.render();

					const anomaly_count = enriched.filter(r => r._is_anomaly).length;
					result_el.innerHTML = `
						<div class="ev-ai-info ev-ai-info--success">
							${__("Found {0} anomalous rows ({1}% threshold)", [
								anomaly_count,
								Math.round(contamination * 100),
							])}
						</div>
						<div class="ev-ai-info" style="font-size:11px;color:var(--text-muted)">
							${__("Rows highlighted in red in the grid.")}
						</div>
					`;
				},
				error: () => {
					result_el.innerHTML = `<div class="ev-ai-info ev-ai-info--error">${__("Analysis failed — check that scikit-learn is installed")}</div>`;
				},
			});
		});

		// ── Run Clustering ─────────────────────────────────────────────────
		drawer.querySelector(".ev-ai-run-cluster").addEventListener("click", () => {
			const selected = [...drawer.querySelectorAll(".ev-jc-atab-body[data-tab=cluster] .ev-ai-field-cb input:checked")]
				.map(cb => cb.value);
			if (!selected.length) {
				frappe.show_alert({ message: __("Select at least one numeric column"), indicator: "orange" }, 3);
				return;
			}
			const k = parseInt(drawer.querySelector(".ev-ai-k-select").value);
			const result_el = drawer.querySelector(".ev-ai-result-cluster");
			result_el.innerHTML = `<div class="ev-ai-spinner">⏳ ${__("Running…")}</div>`;

			frappe.call({
				method: "excel_view.api.cluster_data",
				args: {
					rows:           JSON.stringify(data),
					numeric_fields: JSON.stringify(selected),
					n_clusters:     k,
				},
				callback: (r) => {
					const result = r.message || {};
					const enriched = result.rows || [];
					if (!enriched.length) {
						result_el.innerHTML = `<div class="ev-ai-info">${__("Not enough data (min 6 rows)")}</div>`;
						return;
					}
					// Inject cluster column into board data
					enriched.forEach((row, i) => {
						if (data[i]) data[i]._cluster = row._cluster;
					});
					this.board.hot?.render();

					const k_used = result.n_clusters;
					const summary = result.summary || [];
					const summary_html = summary.map(s => {
						const centroid_vals = selected.map(f => `${f}: <b>${s[f]?.toFixed(2) ?? "–"}</b>`).join(", ");
						return `<li>Cluster ${s.cluster}: ${centroid_vals}</li>`;
					}).join("");

					result_el.innerHTML = `
						<div class="ev-ai-info ev-ai-info--success">
							${__("Grouped into {0} clusters. Column _cluster added to grid.", [k_used])}
						</div>
						<ul class="ev-ai-summary" style="font-size:11px;margin-top:6px">${summary_html}</ul>
					`;
				},
				error: () => {
					result_el.innerHTML = `<div class="ev-ai-info ev-ai-info--error">${__("Clustering failed — check that scikit-learn is installed")}</div>`;
				},
			});
		});
	}

	/** Render the association rules dialog table. */
	_show_patterns_dialog(rules) {
		const rows_html = rules.map(r => `
			<tr>
				<td>${r.antecedents.map(a => `<code>${frappe.utils.escape_html(a)}</code>`).join(" AND ")}</td>
				<td>${r.consequents.map(c => `<code>${frappe.utils.escape_html(c)}</code>`).join(", ")}</td>
				<td>${Math.round(r.support * 100)}%</td>
				<td><strong>${Math.round(r.confidence * 100)}%</strong></td>
				<td class="${r.lift >= 2 ? "ev-lift-high" : ""}">${r.lift}×</td>
			</tr>
		`).join("");

		const d = new frappe.ui.Dialog({
			title: __("📊 Discovered Patterns — {0}", [this.board.doctype]),
			size:  "large",
		});
		d.$body.html(`
			<p class="text-muted" style="font-size:12px;margin-bottom:10px">
				${__("Association rules in joined data (min support 10%, min confidence 50%, lift ≥ 1.2×)")}
			</p>
			<table class="table table-condensed ev-jc-patterns-table">
				<thead>
					<tr>
						<th>${__("IF")}</th>
						<th>${__("THEN")}</th>
						<th>${__("Support")}</th>
						<th>${__("Confidence")}</th>
						<th>${__("Lift")}</th>
					</tr>
				</thead>
				<tbody>${rows_html}</tbody>
			</table>
		`);
		d.show();
	}
};
