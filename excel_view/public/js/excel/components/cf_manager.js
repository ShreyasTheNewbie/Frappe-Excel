/**
 * excel_view/components/cf_manager.js
 *
 * ConditionalFormatManager — dialog to create/manage CF rules,
 * persists rules to user_settings, and triggers grid re-render.
 *
 * Rule types:
 *   cell       — compare cell value (>, <, =, !=, >=, <=, between, contains)
 *   colorscale — gradient from min→(mid)→max color across the range
 *   topN       — highlight top/bottom N values (absolute or %)
 *   duplicate  — highlight duplicate values
 *   unique     — highlight unique values
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.CFManager = class CFManager {
	constructor({ board }) {
		this.board = board;
	}

	open_dialog() {
		this._build_dialog();
	}

	// ── Dialog ──────────────────────────────────────────────────────────────

	_build_dialog() {
		// Default range: preserve column selection, but always span ALL rows
		// so users don't accidentally create single-row rules
		const sel = this.board.hot?.getSelectedLast() || [0, 0, 0, 0];
		const c1 = Math.min(sel[1], sel[3]);
		const c2 = Math.max(sel[1], sel[3]);
		const last_row = Math.max(0, (this.board.list_view?.data?.length || 1) - 1);
		this._default_range = { r1: 0, c1, r2: last_row, c2 };

		this.$modal = $(`
			<div class="ev-cf-modal modal show" tabindex="-1" style="display:flex;align-items:center;justify-content:center;position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.35)">
				<div class="ev-cf-dialog" style="background:#fff;border-radius:6px;width:680px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.2)">
					<div class="ev-cf-dialog-header" style="padding:14px 20px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;justify-content:space-between">
						<strong>${__("Conditional Formatting")}</strong>
						<button class="ev-cf-close btn btn-sm btn-default">&#x2715;</button>
					</div>
					<div class="ev-cf-body" style="flex:1;overflow-y:auto;padding:16px 20px">
						<div class="ev-cf-rule-list"></div>
						<button class="ev-cf-add-rule btn btn-sm btn-primary" style="margin-top:10px">+ ${__("New Rule")}</button>
					</div>
					<div class="ev-cf-dialog-footer" style="padding:10px 20px;border-top:1px solid var(--border-color);display:flex;justify-content:flex-end;gap:8px">
						<button class="ev-cf-apply btn btn-primary btn-sm">${__("Apply")}</button>
						<button class="ev-cf-cancel btn btn-default btn-sm">${__("Close")}</button>
					</div>
				</div>
			</div>
		`).appendTo(document.body);

		this._render_rule_list();

		this.$modal.find(".ev-cf-close, .ev-cf-cancel").on("click", () => this._close());
		this.$modal.find(".ev-cf-add-rule").on("click", () => this._open_rule_editor(null));
		this.$modal.find(".ev-cf-apply").on("click", () => {
			this._save_rules();
			this._close();
		});
	}

	_render_rule_list() {
		const $list = this.$modal.find(".ev-cf-rule-list");
		$list.empty();
		const rules = this.board.cond_fmt_rules || [];
		if (!rules.length) {
			$list.html(`<div style="color:var(--text-muted);font-size:12px;padding:8px 0">${__("No rules yet. Click \"New Rule\" to add one.")}</div>`);
			return;
		}
		rules.forEach((rule, idx) => {
			const range_str = `R${rule.range.r1+1}:C${rule.range.c1+1} → R${rule.range.r2+1}:C${rule.range.c2+1}`;
			const desc = this._rule_description(rule);
			const swatch = rule.fmt?.bg
				? `<span style="display:inline-block;width:14px;height:14px;background:${rule.fmt.bg};border:1px solid #ccc;border-radius:2px;vertical-align:middle;margin-right:4px"></span>`
				: "";
			const $row = $(`
				<div class="ev-cf-rule-row" data-idx="${idx}">
					<span style="flex:1;font-size:12px">${swatch}${desc} <span style="color:var(--text-muted)">(${range_str})</span></span>
					<button class="ev-cf-edit-rule btn btn-xs btn-default">${__("Edit")}</button>
					<button class="ev-cf-delete-rule btn btn-xs btn-danger">${__("Delete")}</button>
				</div>
			`);
			$row.find(".ev-cf-edit-rule").on("click", () => this._open_rule_editor(idx));
			$row.find(".ev-cf-delete-rule").on("click", () => {
				this.board.cond_fmt_rules.splice(idx, 1);
				this.board._clear_cf_cache?.();
				this.board.hot?.render();
				frappe.model.user_settings.save(this.board.doctype, "excel_cf_rules", this.board.cond_fmt_rules);
				this._render_rule_list();
			});
			$list.append($row);
		});
	}

	_rule_description(rule) {
		switch (rule.type) {
			case "cell":        return `${__("Cell Value")} ${rule.op} ${rule.val1}${rule.val2 ? " " + __("and") + " " + rule.val2 : ""}`;
			case "colorscale":  return __("Color Scale");
			case "topN":        return `${rule.top ? __("Top") : __("Bottom")} ${rule.n}${rule.percent ? "%" : ""}`;
			case "duplicate":   return __("Duplicate Values");
			case "unique":      return __("Unique Values");
			default:            return rule.type;
		}
	}

	// ── Rule editor sub-dialog ───────────────────────────────────────────────

	_open_rule_editor(idx) {
		const existing = idx !== null ? { ...this.board.cond_fmt_rules[idx] } : null;
		const r = existing || { type: "cell", op: ">", val1: "", val2: "", range: { ...this._default_range }, fmt: { bg: "#ffcccc", color: "" } };

		const range_str = (rng) => `${rng.r1}:${rng.c1}:${rng.r2}:${rng.c2}`;

		this.$editor = $(`
			<div class="ev-cf-editor-overlay" style="position:fixed;inset:0;z-index:2100;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center">
				<div style="background:#fff;border-radius:6px;width:480px;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,.25)">
					<strong style="display:block;margin-bottom:12px">${idx !== null ? __("Edit Rule") : __("New Rule")}</strong>

					<div style="margin-bottom:10px">
						<label style="font-size:12px;font-weight:600">${__("Apply to range")}</label><br>
						<input class="ev-cf-range-input form-control form-control-sm" style="width:100%;margin-top:4px" value="${range_str(r.range)}" placeholder="r1:c1:r2:c2">
						<small style="color:var(--text-muted)">${__("Format: startRow:startCol:endRow:endCol (0-indexed)")}</small>
					</div>

					<div style="margin-bottom:10px">
						<label style="font-size:12px;font-weight:600">${__("Rule Type")}</label><br>
						<select class="ev-cf-type-sel form-control form-control-sm" style="margin-top:4px">
							<option value="cell"       ${r.type==="cell"?"selected":""}>${__("Cell Value")}</option>
							<option value="colorscale" ${r.type==="colorscale"?"selected":""}>${__("Color Scale")}</option>
							<option value="topN"       ${r.type==="topN"?"selected":""}>${__("Top / Bottom N")}</option>
							<option value="duplicate"  ${r.type==="duplicate"?"selected":""}>${__("Duplicate Values")}</option>
							<option value="unique"     ${r.type==="unique"?"selected":""}>${__("Unique Values")}</option>
						</select>
					</div>

					<div class="ev-cf-type-params" style="margin-bottom:10px"></div>

					<div class="ev-cf-fmt-row" style="margin-bottom:12px">
						<label style="font-size:12px;font-weight:600">${__("Format")}</label>
						<div style="display:flex;gap:10px;margin-top:4px;align-items:center">
							<label style="font-size:12px">${__("Fill")}</label>
							<input type="color" class="ev-cf-fmt-bg" value="${r.fmt?.bg || "#ffcccc"}" style="width:36px;height:24px;padding:1px;cursor:pointer">
							<label style="font-size:12px">${__("Text")}</label>
							<input type="color" class="ev-cf-fmt-color" value="${r.fmt?.color || "#000000"}" style="width:36px;height:24px;padding:1px;cursor:pointer">
						</div>
					</div>

					<div style="display:flex;justify-content:flex-end;gap:8px">
						<button class="ev-cf-editor-save btn btn-primary btn-sm">${__("Save")}</button>
						<button class="ev-cf-editor-cancel btn btn-default btn-sm">${__("Cancel")}</button>
					</div>
				</div>
			</div>
		`).appendTo(document.body);

		const $type = this.$editor.find(".ev-cf-type-sel");
		const render_params = () => this._render_type_params(this.$editor, $type.val(), r);
		$type.on("change", render_params);
		render_params();

		this.$editor.find(".ev-cf-editor-cancel").on("click", () => this.$editor.remove());
		this.$editor.find(".ev-cf-editor-save").on("click", () => {
			const range_val = this.$editor.find(".ev-cf-range-input").val().split(":");
			const [pr1, pc1, pr2, pc2] = range_val.map(Number);
			const new_rule = {
				id:    existing?.id || `cf_${Date.now()}`,
				type:  $type.val(),
				range: { r1: Math.min(pr1, pr2), c1: Math.min(pc1, pc2), r2: Math.max(pr1, pr2), c2: Math.max(pc1, pc2) },
				fmt:   {
					bg:    this.$editor.find(".ev-cf-fmt-bg").val(),
					color: this.$editor.find(".ev-cf-fmt-color").val() || "",
				},
				...this._read_type_params(this.$editor, $type.val()),
			};
			if (idx !== null) {
				this.board.cond_fmt_rules[idx] = new_rule;
			} else {
				this.board.cond_fmt_rules.push(new_rule);
			}
			this.board._clear_cf_cache?.();
			this.board.hot?.render();
			frappe.model.user_settings.save(this.board.doctype, "excel_cf_rules", this.board.cond_fmt_rules);
			this._render_rule_list();
			this.$editor.remove();
		});
	}

	_render_type_params($editor, type, r) {
		const $p = $editor.find(".ev-cf-type-params");
		const $fmt = $editor.find(".ev-cf-fmt-row");
		$p.empty();
		switch (type) {
			case "cell":
				$fmt.show();
				$p.html(`
					<div style="display:flex;gap:8px;align-items:center">
						<select class="ev-cf-op form-control form-control-sm" style="width:130px">
							${[">" ,">=" ,"<" ,"<=" ,"=" ,"!=" ,"between" ,"contains"]
								.map(op => `<option value="${op}" ${r.op===op?"selected":""}>${op}</option>`).join("")}
						</select>
						<input class="ev-cf-val1 form-control form-control-sm" style="width:100px" value="${r.val1 || ""}" placeholder="${__("Value")}">
						<span class="ev-cf-and-label" style="display:none">${__("and")}</span>
						<input class="ev-cf-val2 form-control form-control-sm ev-cf-val2-input" style="width:100px;display:none" value="${r.val2 || ""}" placeholder="${__("Value 2")}">
					</div>
				`);
				const toggle_v2 = (op) => {
					const show = op === "between";
					$p.find(".ev-cf-and-label, .ev-cf-val2-input").toggle(show).css("display", show ? "inline-block" : "none");
				};
				$p.find(".ev-cf-op").on("change", (e) => toggle_v2(e.target.value));
				toggle_v2(r.op || ">");
				break;
			case "colorscale":
				$fmt.hide();
				$p.html(`
					<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
						<label style="font-size:12px">${__("Min")}</label>
						<input type="color" class="ev-cf-min-color" value="${r.min_color || "#ffffff"}" style="width:36px;height:24px;cursor:pointer">
						<label style="font-size:12px">${__("Mid (opt.)")}</label>
						<input type="color" class="ev-cf-mid-color" value="${r.mid_color || "#ffff00"}" style="width:36px;height:24px;cursor:pointer">
						<label style="font-size:12px">${__("Max")}</label>
						<input type="color" class="ev-cf-max-color" value="${r.max_color || "#ff0000"}" style="width:36px;height:24px;cursor:pointer">
					</div>
				`);
				break;
			case "topN":
				$fmt.show();
				$p.html(`
					<div style="display:flex;gap:8px;align-items:center">
						<select class="ev-cf-topn-dir form-control form-control-sm" style="width:100px">
							<option value="top"    ${r.top!==false?"selected":""}>${__("Top")}</option>
							<option value="bottom" ${!r.top?"selected":""}>${__("Bottom")}</option>
						</select>
						<input type="number" class="ev-cf-topn-n form-control form-control-sm" style="width:70px" value="${r.n || 10}" min="1">
						<select class="ev-cf-topn-pct form-control form-control-sm" style="width:100px">
							<option value="count" ${!r.percent?"selected":""}>${__("Items")}</option>
							<option value="pct"   ${r.percent?"selected":""}>${__("Percent")}</option>
						</select>
					</div>
				`);
				break;
			case "duplicate":
			case "unique":
				$fmt.show();
				$p.html(`<small style="color:var(--text-muted)">${__("No additional parameters needed.")}</small>`);
				break;
		}
	}

	_read_type_params($editor, type) {
		switch (type) {
			case "cell":
				return {
					op:   $editor.find(".ev-cf-op").val(),
					val1: $editor.find(".ev-cf-val1").val(),
					val2: $editor.find(".ev-cf-val2-input").val(),
				};
			case "colorscale":
				return {
					min_color: $editor.find(".ev-cf-min-color").val(),
					mid_color: $editor.find(".ev-cf-mid-color").val() || null,
					max_color: $editor.find(".ev-cf-max-color").val(),
				};
			case "topN":
				return {
					top:     $editor.find(".ev-cf-topn-dir").val() === "top",
					n:       parseInt($editor.find(".ev-cf-topn-n").val(), 10) || 10,
					percent: $editor.find(".ev-cf-topn-pct").val() === "pct",
				};
			default:
				return {};
		}
	}

	// ── Persistence ─────────────────────────────────────────────────────────

	_save_rules() {
		frappe.model.user_settings.save(this.board.doctype, "excel_cf_rules", this.board.cond_fmt_rules);
	}

	_close() {
		this._save_rules();
		this.$modal?.remove();
	}
};
