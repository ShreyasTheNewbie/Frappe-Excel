# Copyright (c) 2026, Ujjwal Aggrawal and contributors
# For license information, please see license.txt

"""
excel_view.api — server-side endpoints for Excel View.

All methods are @frappe.whitelist(), meaning they are accessible via
frappe.call({ method: "excel_view.api.<name>", ... }) from the client.

Security model:
  - Any logged-in user can create workbooks.
  - A workbook is readable by its owner or by anyone if is_public = 1.
  - Only the owner (or System Manager) can update or delete a workbook.
  - Every method verifies that the caller has READ permission on the target
    DocType — so users can't save views for doctypes they can't access.

V2.3 — Frappe Formula Library
  Scalar async formula functions callable from HyperFormula cells:
    FRAPPE_GET(doctype, name, fieldname)
    FRAPPE_SUM(doctype, fieldname [, fk, fv …])
    FRAPPE_COUNT(doctype [, fk, fv …])
    FRAPPE_AVG(doctype, fieldname [, fk, fv …])
    GL_BALANCE(account, company [, from_date, to_date, cost_center, finance_book])
    STOCK_QTY(item_code, warehouse [, as_of_date])
    ITEM_PRICE(item_code, price_list [, qty, customer, uom])
"""

import frappe
from frappe import _

# ── V2.3 helpers ──────────────────────────────────────────────────────────────

#: Fields that exist on every DocType but are NOT in meta.fields — always valid.
_SYSTEM_FIELDS: frozenset[str] = frozenset(
    {
        "name",
        "owner",
        "creation",
        "modified",
        "modified_by",
        "docstatus",
        "idx",
        "_user_tags",
        "_assign",
        "_comments",
        "_seen",
    }
)

#: Hard cap for frappe_aggregate SUM/AVG to avoid runaway DB scans.
_AGGREGATE_ROW_CAP = 50_000


def _validate_fieldname(doctype: str, fieldname: str) -> None:
    """
    Raise DoesNotExistError if *fieldname* is not a valid field on *doctype*.

    Checks system fields first (always allowed), then the live meta — which
    includes custom fields added by any installed app.  This makes the
    validation fully dynamic without any hardcoded field lists.
    """
    if fieldname in _SYSTEM_FIELDS:
        return

    meta = frappe.get_meta(doctype)
    valid_fields = {df.fieldname for df in meta.fields}

    if fieldname not in valid_fields:
        frappe.throw(
            _("Field '{0}' does not exist on DocType '{1}'.").format(fieldname, doctype),
            frappe.DoesNotExistError,
        )


def _parse_filter_pairs(
    fk1=None,
    fv1=None,
    fk2=None,
    fv2=None,
    fk3=None,
    fv3=None,
) -> dict:
    """
    Build a filters dict from up to three SUMIF-style key/value pairs.

    Keys and values that are None or empty string are silently skipped,
    so callers don't need to worry about omitted optional arguments.
    """
    filters: dict = {}
    for key, val in ((fk1, fv1), (fk2, fv2), (fk3, fv3)):
        if key and val is not None and val != "":
            filters[str(key)] = val
    return filters


# ── V2.3 formula endpoints ────────────────────────────────────────────────────


@frappe.whitelist()
def frappe_get(doctype: str, name: str, fieldname: str) -> dict:
    """
    Fetch a single field value from one document.

    Used by the ``FRAPPE_GET(doctype, name, fieldname)`` HyperFormula function.
    Validates fieldname against live meta so custom fields from any app work.

    Returns:
        {"value": <field_value>}  — value may be str, int, float, or None.
    """
    frappe.has_permission(doctype, "read", throw=True)
    _validate_fieldname(doctype, fieldname)

    value = frappe.db.get_value(doctype, name, fieldname)
    return {"value": value}


@frappe.whitelist()
def frappe_aggregate(
    doctype: str,
    fieldname: str | None = None,
    aggr_type: str = "sum",
    fk1=None,
    fv1=None,
    fk2=None,
    fv2=None,
    fk3=None,
    fv3=None,
) -> dict:
    """
    Compute SUM, COUNT, or AVG over a DocType filtered by SUMIF-style pairs.

    Used by ``FRAPPE_SUM``, ``FRAPPE_COUNT``, ``FRAPPE_AVG`` HyperFormula
    functions.  Accepts up to three field/value filter pairs so formulas stay
    readable without JSON escaping.

    Args:
        doctype:    Target DocType name.
        fieldname:  Field to aggregate (required for sum/avg, ignored for count).
        aggr_type:  "sum" | "count" | "avg" (case-insensitive).
        fk1..fk3:  Filter field names (optional).
        fv1..fv3:  Filter values matching fk1..fk3 (optional).

    Returns:
        {"value": <number>}
    """
    frappe.has_permission(doctype, "read", throw=True)

    aggr_type = (aggr_type or "sum").lower()
    if aggr_type not in ("sum", "count", "avg"):
        frappe.throw(_("aggr_type must be 'sum', 'count', or 'avg'."))

    if aggr_type != "count" and not fieldname:
        frappe.throw(_("fieldname is required for sum/avg aggregates."))

    if aggr_type != "count" and fieldname:
        _validate_fieldname(doctype, fieldname)

    filters = _parse_filter_pairs(fk1, fv1, fk2, fv2, fk3, fv3)

    if aggr_type == "count":
        return {"value": frappe.db.count(doctype, filters)}

    rows = frappe.get_list(
        doctype,
        filters=filters,
        fields=[fieldname],
        limit=_AGGREGATE_ROW_CAP,
        ignore_permissions=False,
    )

    vals = [float(r[fieldname]) for r in rows if r.get(fieldname) is not None]

    if not vals:
        return {"value": 0}

    if aggr_type == "sum":
        return {"value": sum(vals)}

    return {"value": sum(vals) / len(vals)}


@frappe.whitelist()
def gl_balance(
    account: str,
    company: str,
    from_date: str | None = None,
    to_date: str | None = None,
    cost_center: str | None = None,
    finance_book: str | None = None,
) -> dict:
    """
    Return the net GL balance (debit − credit) for an account/company/period.

    Used by the ``GL_BALANCE(account, company, …)`` HyperFormula function.
    Returns ``{"value": 0, "note": "…"}`` if ERPNext is not installed so the
    formula degrades gracefully on vanilla Frappe setups.

    Args:
        account:      GL account name (e.g. "Cash - ACME").
        company:      Company name.
        from_date:    Start of period (inclusive).  None = no lower bound.
        to_date:      End of period (inclusive).    None = no upper bound.
        cost_center:  Optional cost-centre filter.
        finance_book: Optional finance-book filter (also matches IS NULL rows).

    Returns:
        {"value": <Decimal as float>}
    """
    if not frappe.db.table_exists("tabGL Entry"):
        return {"value": 0, "note": "GL Entry not available — ERPNext not installed"}

    frappe.has_permission("GL Entry", "read", throw=True)

    conditions = [
        "account  = %(account)s",
        "company  = %(company)s",
        "is_cancelled = 0",
    ]
    params: dict = {"account": account, "company": company}

    if from_date:
        conditions.append("posting_date >= %(from_date)s")
        params["from_date"] = from_date
    if to_date:
        conditions.append("posting_date <= %(to_date)s")
        params["to_date"] = to_date
    if cost_center:
        conditions.append("cost_center = %(cost_center)s")
        params["cost_center"] = cost_center
    if finance_book:
        conditions.append("(finance_book = %(finance_book)s OR finance_book IS NULL)")
        params["finance_book"] = finance_book

    where = " AND ".join(conditions)
    result = frappe.db.sql(
        f"SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) AS balance "
        f"FROM `tabGL Entry` WHERE {where}",
        params,
        as_dict=True,
    )

    return {"value": float(result[0].get("balance") or 0)}


@frappe.whitelist()
def stock_qty(
    item_code: str,
    warehouse: str,
    as_of_date: str | None = None,
) -> dict:
    """
    Return current or point-in-time stock quantity for an item/warehouse.

    Used by ``STOCK_QTY(item_code, warehouse [, as_of_date])``.
    When *as_of_date* is omitted the Bin table is used (fast current balance).
    When a date is supplied the Stock Ledger Entry table is queried to return
    the running total up to that date.

    Returns:
        {"value": <float>}
    """
    if not frappe.db.table_exists("tabBin"):
        return {"value": 0, "note": "Bin doctype not available — ERPNext not installed"}

    frappe.has_permission("Bin", "read", throw=True)

    if not as_of_date:
        qty = frappe.db.get_value(
            "Bin",
            {"item_code": item_code, "warehouse": warehouse},
            "actual_qty",
        )
        return {"value": float(qty or 0)}

    # Point-in-time balance via Stock Ledger Entry
    result = frappe.db.sql(
        """
        SELECT COALESCE(SUM(actual_qty), 0) AS qty
        FROM   `tabStock Ledger Entry`
        WHERE  item_code    = %(item)s
          AND  warehouse    = %(wh)s
          AND  posting_date <= %(date)s
          AND  docstatus    = 1
        """,
        {"item": item_code, "wh": warehouse, "date": as_of_date},
        as_dict=True,
    )
    return {"value": float(result[0].get("qty") or 0)}


@frappe.whitelist()
def item_price(
    item_code: str,
    price_list: str,
    qty: float | None = None,
    customer: str | None = None,
    uom: str | None = None,
) -> dict:
    """
    Return the selling price for an item from an Item Price record.

    Used by ``ITEM_PRICE(item_code, price_list [, qty, customer, uom])``.
    Picks the most recently valid price (valid_from ≤ today ≤ valid_upto).
    Falls back to the most recently modified price if no date-valid record
    exists.

    Args:
        item_code:  Item code.
        price_list: Price list name (e.g. "Standard Selling").
        qty:        Quantity (reserved for future tiered pricing — unused now).
        customer:   Customer (reserved for future customer-group pricing).
        uom:        Unit of measure filter.

    Returns:
        {"value": <float>}
    """
    if not frappe.db.table_exists("tabItem Price"):
        return {"value": 0, "note": "Item Price not available — ERPNext not installed"}

    frappe.has_permission("Item Price", "read", throw=True)

    filters: dict = {
        "item_code":  item_code,
        "price_list": price_list,
        "selling":    1,
    }
    if uom:
        filters["uom"] = uom

    prices = frappe.get_list(
        "Item Price",
        filters=filters,
        fields=["price_list_rate", "valid_from", "valid_upto"],
        order_by="valid_from desc",
    )

    if not prices:
        return {"value": 0}

    today = frappe.utils.today()

    for p in prices:
        valid_from  = p.get("valid_from")
        valid_upto  = p.get("valid_upto")

        # Skip if period hasn't started yet
        if valid_from and frappe.utils.getdate(valid_from) > frappe.utils.getdate(today):
            continue
        # Skip if period has already ended
        if valid_upto and frappe.utils.getdate(valid_upto) < frappe.utils.getdate(today):
            continue

        return {"value": float(p.get("price_list_rate") or 0)}

    # Fallback: first record (most recent valid_from regardless of date range)
    return {"value": float(prices[0].get("price_list_rate") or 0)}


# ── Read ──────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def get_workbooks(doctype_name: str) -> list[dict]:
	"""
	Return workbooks for *doctype_name* that the current user may open:
	  - workbooks they own, OR
	  - workbooks marked is_public = 1 (by any user).

	Returns a lightweight list (no heavy JSON fields) suitable for rendering
	the "Open View" dialog.
	"""
	frappe.has_permission(doctype_name, "read", throw=True)

	# Raw SQL is cleaner than chaining frappe.get_all OR-filters.
	return frappe.db.sql(
		"""
		SELECT name, title, owner, is_public, modified
		FROM   `tabExcel Workbook`
		WHERE  doctype_name = %(dt)s
		  AND  (owner = %(user)s OR is_public = 1)
		ORDER  BY modified DESC
		LIMIT  200
		""",
		{"dt": doctype_name, "user": frappe.session.user},
		as_dict=True,
	)


@frappe.whitelist()
def load_workbook(name: str) -> dict:
	"""
	Return the full workbook document (including JSON config fields).

	Returns {"not_found": True} when the workbook has been deleted so the
	client can silently clear its stale user_settings reference instead of
	showing a scary "Not found" error dialog.
	"""
	try:
		doc = frappe.get_doc("Excel Workbook", name)
	except frappe.DoesNotExistError:
		return {"not_found": True, "name": name}

	if doc.owner != frappe.session.user and not doc.is_public:
		frappe.throw(
			_("You don't have permission to open this view."),
			frappe.PermissionError,
		)

	return doc.as_dict()


# ── Write ─────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def save_workbook(
	title: str,
	doctype_name: str,
	columns_config: str,
	formula_columns: str,
	filters: str,
	sort_by: str | None = None,
	is_public: int = 0,
	workbook_name: str | None = None,
	join_config: str | None = None,
) -> dict:
	"""
	Create a new workbook or update an existing one.

	Args:
	    title:           Human-readable name shown in the "Open View" dialog.
	    doctype_name:    The Frappe DocType this view is bound to.
	    columns_config:  JSON string — ordered list of {fieldname, width} / formula-col defs.
	    formula_columns: JSON string — formula column defs with per-doc values.
	    filters:         JSON string — list of [fieldname, op, value] filter triples.
	    sort_by:         JSON string — {field, order} sort config.
	    is_public:       1 = shared with all users, 0 = private.
	    workbook_name:   If set, update this existing workbook; else create new.
	    join_config:     JSON string — V2.4 IntelliFlow join canvas state (nodes, edges, positions).

	Returns:
	    {"name": <doc_name>, "title": <title>}
	"""
	frappe.has_permission(doctype_name, "read", throw=True)

	if workbook_name:
		doc = frappe.get_doc("Excel Workbook", workbook_name)
		if doc.owner != frappe.session.user and not frappe.has_role("System Manager"):
			frappe.throw(_("You can only update your own saved views."))
	else:
		doc = frappe.new_doc("Excel Workbook")
		doc.doctype_name = doctype_name
		# owner is set in ExcelWorkbook.before_insert() — not trusted from client.

	doc.title          = title
	doc.is_public      = frappe.utils.cint(is_public)
	doc.columns_config  = columns_config
	doc.formula_columns = formula_columns
	doc.filters        = filters
	doc.sort_by        = sort_by or "{}"
	doc.join_config    = join_config or "{}"

	doc.save(ignore_permissions=False)

	return {"name": doc.name, "title": doc.title}


# ── Delete ────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def delete_workbook(name: str) -> dict:
	"""
	Delete a workbook.  Only the owner or a System Manager may do this.
	The controller's before_delete hook also enforces this, but we check
	early here to give a clear error message.
	"""
	doc = frappe.get_doc("Excel Workbook", name)

	if doc.owner != frappe.session.user and not frappe.has_role("System Manager"):
		frappe.throw(_("You can only delete your own saved views."))

	frappe.delete_doc("Excel Workbook", name, ignore_permissions=True)

	return {"success": True}


# ── V2.4.5 — IntelliFlow AI: helpers + 4-layer validation + discovery ─────────


# ── Shared helpers ────────────────────────────────────────────────────────────

def _sample_and_profile(doctype: str, field: str, limit: int = 100) -> dict:
	"""
	Sample `limit` values from doctype.field and detect their structural pattern.

	Returns:
	  {
	    "values":     set[str]           — sampled raw values
	    "raw_list":   list[str]          — ordered list (for cardinality check)
	    "pattern":    str                — one of:
	                    "naming_series"  (EMP-0001, SINV-2024-00001)
	                    "hash"           (len≥10, no spaces)
	                    "email"          (contains @)
	                    "date"           (YYYY-MM-DD…)
	                    "numeric"        (pure numbers / decimals)
	                    "text"           (everything else)
	    "prefix_set": set[str]           — naming-series prefixes (empty otherwise)
	  }
	"""
	import re

	raw = [str(r) for r in frappe.get_all(doctype, pluck=field, limit=limit) if r]
	if not raw:
		return {"values": set(), "raw_list": [], "pattern": "text", "prefix_set": set()}

	s = raw[:50]
	n = len(s)

	def _ratio(fn):
		return sum(1 for v in s if fn(v)) / n

	series_re = re.compile(r'^([A-Z][A-Z0-9-]*)-(?:\d{4}-)?[0-9]+$')

	if _ratio(lambda v: bool(re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', v))) >= 0.8:
		return {"values": set(raw), "raw_list": raw, "pattern": "email", "prefix_set": set()}

	if _ratio(lambda v: bool(re.match(r'^\d{4}-\d{2}-\d{2}', v))) >= 0.8:
		return {"values": set(raw), "raw_list": raw, "pattern": "date", "prefix_set": set()}

	if _ratio(lambda v: bool(re.match(r'^-?\d+\.?\d*$', v))) >= 0.8:
		return {"values": set(raw), "raw_list": raw, "pattern": "numeric", "prefix_set": set()}

	series_matches = [series_re.match(v) for v in s]
	if sum(1 for m in series_matches if m) / n >= 0.7:
		prefixes = {m.group(1) for m in series_matches if m}
		return {"values": set(raw), "raw_list": raw, "pattern": "naming_series", "prefix_set": prefixes}

	if _ratio(lambda v: len(v) >= 10 and " " not in v) >= 0.8:
		return {"values": set(raw), "raw_list": raw, "pattern": "hash", "prefix_set": set()}

	return {"values": set(raw), "raw_list": raw, "pattern": "text", "prefix_set": set()}


def _l1_pattern_score(src_prof: dict, tgt_prof: dict) -> float:
	"""Layer 1 score from structural pattern comparison."""
	sp = src_prof["pattern"]
	tp = tgt_prof["pattern"]

	if sp == "naming_series" and tp == "naming_series":
		# Boost if they share at least one naming-series prefix
		if src_prof["prefix_set"] & tgt_prof["prefix_set"]:
			return 0.95
		return 0.80

	if sp == "hash"    and tp == "hash":    return 0.70
	if sp == "email"   and tp == "email":   return 0.60
	if sp == tp:                            return 0.40   # same generic type
	return 0.10                                           # different


# Hard incompatible pattern pairs — type-gate (Layer 2)
_INCOMPATIBLE_PAIRS = {
	("date",           "numeric"),       ("numeric",        "date"),
	("date",           "email"),         ("email",          "date"),
	("numeric",        "email"),         ("email",          "numeric"),
	("numeric",        "naming_series"), ("naming_series",  "numeric"),
	("numeric",        "hash"),          ("hash",           "numeric"),
}


def _grade(composite: float, method: str) -> str:
	if method == "meta":    return "S"
	if composite >= 0.80:   return "A"
	if composite >= 0.60:   return "B"
	if composite >= 0.40:   return "C"
	if composite >= 0.25:   return "D"
	return "F"


def _cardinality_and_coverage(src_list: list, tgt_list: list):
	"""Returns (cardinality_str, coverage_float)."""
	from collections import Counter
	src_set = set(src_list)
	tgt_set = set(tgt_list)
	coverage = round(len(src_set & tgt_set) / max(len(src_set), 1), 2)
	tgt_cnt  = Counter(tgt_list)
	matched  = [v for v in src_list if v in tgt_set]
	max_m    = max((tgt_cnt.get(v, 0) for v in matched), default=0)
	return ("1:1" if max_m <= 1 else "1:N"), coverage


# ── Link-graph cache (V2.4.5) ─────────────────────────────────────────────────
#
# Instead of calling frappe.get_meta(dt) for every DocType in a loop
# (= N individual DB round-trips), we run ONE SQL JOIN on tabDocField
# that returns every Link field across the entire site, then cache the
# result in Redis for 5 minutes.
#
# Performance:
#   Before: suggest_joins ≈ 300 get_meta() calls  ≈ 300 DB queries
#   After : 1-2 SQL JOIN queries → edge list       → cached, no repeat

_GRAPH_CACHE_KEY = "ev_link_graph_edges_v1"
_GRAPH_CACHE_TTL = 300  # seconds


def _get_all_link_edges() -> list:
	"""
	Return every Link-field edge across all regular (non-child, non-single)
	DocTypes in a SINGLE SQL query. Both sides of the edge must be regular
	DocTypes — child tables and singles are excluded by the JOIN filter.

	Custom fields (tabCustom Field) are merged via UNION ALL.
	Result is cached in Redis for 5 min; subsequent calls are instant.

	Each entry: {"doctype": str, "fieldname": str, "label": str, "target": str}
	"""
	cached = frappe.cache().get_value(_GRAPH_CACHE_KEY)
	if cached is not None:
		return cached

	sql = """
		SELECT df.parent   AS doctype,
		       df.fieldname,
		       COALESCE(NULLIF(df.label, ''), df.fieldname) AS label,
		       df.options  AS target
		FROM   `tabDocField` df
		JOIN   `tabDocType`  src ON src.name = df.parent
		JOIN   `tabDocType`  tgt ON tgt.name = df.options
		WHERE  df.fieldtype = 'Link'
		  AND  df.options IS NOT NULL AND df.options != ''
		  AND  src.issingle = 0 AND src.istable = 0
		  AND  tgt.issingle = 0 AND tgt.istable = 0

		UNION ALL

		SELECT cf.dt        AS doctype,
		       cf.fieldname,
		       COALESCE(NULLIF(cf.label, ''), cf.fieldname) AS label,
		       cf.options   AS target
		FROM   `tabCustom Field` cf
		JOIN   `tabDocType`  src ON src.name = cf.dt
		JOIN   `tabDocType`  tgt ON tgt.name = cf.options
		WHERE  cf.fieldtype = 'Link'
		  AND  cf.options IS NOT NULL AND cf.options != ''
		  AND  src.issingle = 0 AND src.istable = 0
		  AND  tgt.issingle = 0 AND tgt.istable = 0
	"""
	edges = [dict(row) for row in frappe.db.sql(sql, as_dict=True)]
	frappe.cache().set_value(_GRAPH_CACHE_KEY, edges, expires_in_sec=_GRAPH_CACHE_TTL)
	return edges


# ── Main validation endpoint ──────────────────────────────────────────────────

@frappe.whitelist()
def validate_join(
	src_doctype: str,
	src_field: str,
	tgt_doctype: str,
	tgt_field: str,
) -> dict:
	"""
	4-Layer join validation for IntelliFlow canvas (V2.4.5).

	Layer 0 — Meta Guard    : Frappe Link field → immediate Grade S result.
	Layer 1 — Pattern Match  : Naming series / hash / email / date / numeric / text.
	Layer 2 — Type Gate      : Hard incompatibility (date↔numeric etc.) → instant F.
	Layer 3 — Value Overlap  : Set intersection confidence score.
	Layer 4 — Semantic       : RapidFuzz + dynamic std_fields context boost.

	Returns dict with keys:
	  valid, confidence, method, grade, cardinality, coverage,
	  src_pattern, tgt_pattern, message
	"""
	from rapidfuzz import fuzz as _fuzz

	frappe.has_permission(src_doctype, "read", throw=True)
	frappe.has_permission(tgt_doctype, "read", throw=True)

	# ── Layer 0: Meta Guard ───────────────────────────────────────────────────
	# Case A: src_doctype.src_field is a Link → tgt_doctype, joined on tgt.name
	if tgt_field == "name":
		for df in frappe.get_meta(src_doctype).fields:
			if df.fieldtype == "Link" and df.options == tgt_doctype and df.fieldname == src_field:
				cardinality, coverage = _cardinality_and_coverage(
					[str(r) for r in frappe.get_all(src_doctype, pluck=src_field, limit=100) if r],
					[str(r) for r in frappe.get_all(tgt_doctype, pluck="name",    limit=100) if r],
				)
				return {
					"valid": True, "confidence": 1.0, "method": "meta", "grade": "S",
					"cardinality": cardinality, "coverage": coverage,
					"src_pattern": "naming_series", "tgt_pattern": "naming_series",
					"message": f"Link field: {src_doctype}.{df.label or df.fieldname} → {tgt_doctype}",
				}

	# Case B: tgt_doctype.tgt_field is a Link → src_doctype, joined on src.name
	if src_field == "name":
		for df in frappe.get_meta(tgt_doctype).fields:
			if df.fieldtype == "Link" and df.options == src_doctype and df.fieldname == tgt_field:
				cardinality, coverage = _cardinality_and_coverage(
					[str(r) for r in frappe.get_all(src_doctype, pluck="name",    limit=100) if r],
					[str(r) for r in frappe.get_all(tgt_doctype, pluck=tgt_field, limit=100) if r],
				)
				return {
					"valid": True, "confidence": 1.0, "method": "meta", "grade": "S",
					"cardinality": cardinality, "coverage": coverage,
					"src_pattern": "naming_series", "tgt_pattern": "naming_series",
					"message": f"Link field: {tgt_doctype}.{df.label or df.fieldname} → {src_doctype}",
				}

	# ── Layers 1-4: ML pipeline ───────────────────────────────────────────────
	src_prof = _sample_and_profile(src_doctype, src_field)
	tgt_prof = _sample_and_profile(tgt_doctype, tgt_field)
	src_pat  = src_prof["pattern"]
	tgt_pat  = tgt_prof["pattern"]

	# Layer 2: type gate (hard incompatibility)
	if (src_pat, tgt_pat) in _INCOMPATIBLE_PAIRS:
		return {
			"valid": False, "confidence": 0.0, "method": "type_mismatch",
			"grade": "F", "cardinality": None, "coverage": None,
			"src_pattern": src_pat, "tgt_pattern": tgt_pat,
			"message": _(
				"Type mismatch: {0} ({1}) cannot join with {2} ({3})"
			).format(src_field, src_pat, tgt_field, tgt_pat),
		}

	# Layer 1: structural pattern score
	l1_score = _l1_pattern_score(src_prof, tgt_prof)

	# Layer 3: value overlap
	src_vals = src_prof["values"]
	tgt_vals = tgt_prof["values"]

	if not src_vals or not tgt_vals:
		return {
			"valid": False, "confidence": 0.0, "method": "no_data",
			"grade": "?", "cardinality": None, "coverage": None,
			"src_pattern": src_pat, "tgt_pattern": tgt_pat,
			"message": _("No data to sample — add records to both DocTypes first"),
		}

	overlap    = len(src_vals & tgt_vals)
	overlap_r  = round(overlap / max(len(src_vals), len(tgt_vals)), 2)
	composite  = round(max(l1_score, overlap_r), 2)   # best signal wins

	cardinality, coverage = _cardinality_and_coverage(
		src_prof["raw_list"], tgt_prof["raw_list"]
	)

	# Layer 4: semantic (RapidFuzz + dynamic std_fields boost)
	fuzz_ratio   = _fuzz.token_sort_ratio(src_field, tgt_field) / 100.0
	partial_r    = _fuzz.partial_ratio(src_field, tgt_field) / 100.0
	semantic     = round(max(fuzz_ratio, partial_r), 2)

	# Dynamic std_fields boost: same fieldname on both sides → strongly correlated
	try:
		std_names = {df.get("fieldname") for df in frappe.model.std_fields}
		if src_field in std_names and tgt_field == src_field:
			semantic = max(semantic, 0.85)
	except Exception:
		pass

	# Dynamic meta-context: catch Link fields to non-"name" targets
	try:
		src_df = next(
			(df for df in frappe.get_meta(src_doctype).fields if df.fieldname == src_field),
			None,
		)
		if src_df and src_df.fieldtype == "Link" and src_df.options == tgt_doctype:
			semantic = 1.0
	except Exception:
		pass

	final_confidence = round(0.7 * composite + 0.3 * semantic, 2)
	grade            = _grade(final_confidence, "ml")
	valid            = final_confidence >= 0.25

	# Human-readable message
	if valid:
		msg = f"{int(final_confidence * 100)}% confidence — {overlap} overlapping values"
		if grade == "D":
			msg += f" ({__('Low confidence — verify this join is intentional')})"
	else:
		msg = (
			f"Only {int(final_confidence * 100)}% confidence ({overlap} overlapping values) "
			"— these fields likely don't join correctly"
		)

	return {
		"valid":       valid,
		"confidence":  final_confidence,
		"method":      "ml",
		"grade":       grade,
		"cardinality": cardinality,
		"coverage":    coverage,
		"src_pattern": src_pat,
		"tgt_pattern": tgt_pat,
		"message":     msg,
	}


# ── AI Discovery endpoints ────────────────────────────────────────────────────

@frappe.whitelist()
def suggest_joins(base_doctype: str, force_refresh: bool = False) -> list:
	"""
	AI-powered join candidate discovery (V2.4.5).

	Layer A — cached edge scan (O(E), no per-DT meta calls):
	  Iterate _get_all_link_edges() (1-2 SQL queries, Redis-cached 5 min).
	  Any edge where one side == base_doctype → score 1.0, method "meta".

	Layer B — TF-IDF + rapidfuzz for non-meta candidates:
	  Batch-fetch field labels for up to 60 non-meta DTs in 2 SQL queries
	  (instead of 60 get_meta() calls).
	  composite = 0.6 * tfidf_cosine + 0.4 * fuzz_token_sort ≥ 0.40.

	force_refresh=True: bust the 5-min Redis edge-list cache before scanning.
	  Use when a new DocType or Link field has been added to the site schema.

	Returns [{doctype, src_field, tgt_field, score, method, reason}] sorted
	  meta-links alphabetically first, then ML by score desc.
	No hardcoded DocType names.  No per-DT get_meta() loops.
	"""
	if frappe.utils.cint(force_refresh):
		frappe.cache().delete_value(_GRAPH_CACHE_KEY)
	from sklearn.feature_extraction.text import TfidfVectorizer
	from sklearn.metrics.pairwise import cosine_similarity
	from rapidfuzz import fuzz

	frappe.has_permission(base_doctype, "read", throw=True)

	SKIP = {
		"Section Break", "Column Break", "Tab Break", "Fold", "Heading",
		"HTML", "Custom HTML", "Table", "Table MultiSelect", "Password",
	}

	# Layer A: scan cached edge list — O(E), 0 extra DB queries
	edges      = _get_all_link_edges()
	candidates = {}

	for e in edges:
		dt, tgt = e["doctype"], e["target"]

		if tgt == base_doctype and dt != base_doctype:
			# dt.field → base_doctype  (base is the JOIN target)
			if dt not in candidates:
				try:
					if frappe.has_permission(dt, "read"):
						candidates[dt] = dict(
							doctype=dt, src_field="name", tgt_field=e["fieldname"],
							score=1.0, method="meta",
							reason=f"{dt}.{e['label']} → {base_doctype}",
						)
				except Exception:
					pass

		elif dt == base_doctype and tgt != base_doctype:
			# base_doctype.field → tgt  (base is the JOIN source)
			if tgt not in candidates:
				try:
					if frappe.has_permission(tgt, "read"):
						candidates[tgt] = dict(
							doctype=tgt, src_field=e["fieldname"], tgt_field="name",
							score=1.0, method="meta",
							reason=f"{base_doctype}.{e['label']} → {tgt}",
						)
				except Exception:
					pass

	# Layer B: TF-IDF + rapidfuzz for non-meta candidates
	# Collect up to 60 non-meta DTs that appear in the edge list
	seen_dts = {e["doctype"] for e in edges} | {e["target"] for e in edges}
	non_meta = [dt for dt in seen_dts
	            if dt not in candidates and dt != base_doctype][:60]

	base_meta   = frappe.get_meta(base_doctype)
	base_fields = [df for df in base_meta.fields
	               if df.fieldtype not in SKIP and not df.is_virtual]
	if not base_fields or not non_meta:
		return sorted(candidates.values(), key=lambda x: (-x["score"], x["doctype"]))

	base_corpus = [f"{df.label or df.fieldname} {df.fieldname}" for df in base_fields]

	# Batch-fetch fields for all non_meta DTs in 2 SQL queries (no per-DT meta calls)
	skip_list = list(SKIP)
	std_rows = frappe.db.sql("""
		SELECT parent AS doctype, fieldname,
		       COALESCE(NULLIF(label, ''), fieldname) AS label, fieldtype
		FROM   `tabDocField`
		WHERE  parent IN %(dts)s AND fieldtype NOT IN %(skip)s
		ORDER  BY parent, idx
	""", {"dts": non_meta, "skip": skip_list}, as_dict=True)

	cust_rows = frappe.db.sql("""
		SELECT dt AS doctype, fieldname,
		       COALESCE(NULLIF(label, ''), fieldname) AS label, fieldtype
		FROM   `tabCustom Field`
		WHERE  dt IN %(dts)s AND fieldtype NOT IN %(skip)s
	""", {"dts": non_meta, "skip": skip_list}, as_dict=True)

	dt_fields: dict = {}
	for r in list(std_rows) + list(cust_rows):
		dt_fields.setdefault(r["doctype"], []).append(r)

	vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), max_features=5000)

	for dt in non_meta:
		tgt_rows = dt_fields.get(dt)
		if not tgt_rows:
			continue
		try:
			if not frappe.has_permission(dt, "read"):
				continue
		except Exception:
			continue

		tgt_corpus = [f"{r['label']} {r['fieldname']}" for r in tgt_rows]
		try:
			tfidf     = vectorizer.fit_transform(base_corpus + tgt_corpus)
			base_vecs = tfidf[: len(base_corpus)]
			tgt_vecs  = tfidf[len(base_corpus):]
			sim       = cosine_similarity(base_vecs, tgt_vecs)
			bi, ti    = divmod(int(sim.argmax()), len(tgt_rows))
			best_sim  = float(sim[bi, ti])
			if best_sim < 0.45:
				continue
			b_df      = base_fields[bi]
			t_row     = tgt_rows[ti]
			fuzz_s    = fuzz.token_sort_ratio(b_df.fieldname, t_row["fieldname"]) / 100.0
			composite = round(0.6 * best_sim + 0.4 * fuzz_s, 2)
			if composite >= 0.40:
				candidates[dt] = dict(
					doctype=dt, src_field=b_df.fieldname, tgt_field=t_row["fieldname"],
					score=composite, method="ml",
					reason=(
						f"Field similarity: {b_df.label or b_df.fieldname}"
						f" ↔ {t_row['label']}"
					),
				)
		except Exception:
			continue

	# meta links (score=1.0) sorted alphabetically, then ML candidates by score desc
	return sorted(candidates.values(), key=lambda x: (-x["score"], x["doctype"]))


@frappe.whitelist()
def rank_field_matches(src_doctype: str, src_field: str, tgt_doctype: str) -> dict:
	"""
	Score every field in tgt_doctype against src_field using TF-IDF + rapidfuzz.
	Returns {fieldname: score 0-1}.
	Used by the canvas to highlight target ports while user drags a wire.
	"""
	from sklearn.feature_extraction.text import TfidfVectorizer
	from sklearn.metrics.pairwise import cosine_similarity
	from rapidfuzz import fuzz

	frappe.has_permission(src_doctype, "read", throw=True)
	frappe.has_permission(tgt_doctype, "read", throw=True)

	SKIP = {
		"Section Break", "Column Break", "Tab Break", "Fold", "Heading",
		"HTML", "Custom HTML", "Table", "Table MultiSelect", "Password",
	}

	src_meta = frappe.get_meta(src_doctype)
	tgt_meta = frappe.get_meta(tgt_doctype)
	src_df   = next((df for df in src_meta.fields if df.fieldname == src_field), None)
	src_lbl  = f"{src_df.label or src_field} {src_field}" if src_df else src_field

	# Always include "name" (ID) as a candidate target
	class _NameField:
		fieldname, label, fieldtype = "name", "ID", "Data"

	tgt_fields = [_NameField()] + [
		df for df in tgt_meta.fields
		if df.fieldtype not in SKIP and not df.is_virtual
	]
	tgt_corpus = [f"{df.label or df.fieldname} {df.fieldname}" for df in tgt_fields]

	scores = {}
	try:
		vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4))
		tfidf      = vectorizer.fit_transform([src_lbl] + tgt_corpus)
		sims       = cosine_similarity(tfidf[0:1], tfidf[1:])[0]
		for i, df in enumerate(tgt_fields):
			fz = fuzz.token_sort_ratio(src_field, df.fieldname) / 100.0
			scores[df.fieldname] = round(0.6 * float(sims[i]) + 0.4 * fz, 2)
	except Exception:
		for df in tgt_fields:
			scores[df.fieldname] = round(
				fuzz.token_sort_ratio(src_field, df.fieldname) / 100.0, 2
			)
	return scores


@frappe.whitelist()
def find_join_path(src_doctype: str, tgt_doctype: str) -> list:
	"""
	Find the shortest join path between two DocTypes using networkx BFS.

	Graph is built from _get_all_link_edges() — 1-2 SQL queries, Redis-cached
	for 5 min — instead of N × get_meta() calls.  Permission is checked only
	for intermediate nodes on the found path (not all DocTypes).

	Returns [{from_doctype, to_doctype, src_field, tgt_field, via_label}]
	or [] if no path exists or any intermediate node is inaccessible.
	"""
	import networkx as nx

	frappe.has_permission(src_doctype, "read", throw=True)
	frappe.has_permission(tgt_doctype, "read", throw=True)

	# Build graph entirely from cached edge list — zero extra DB calls
	G = nx.DiGraph()
	for e in _get_all_link_edges():
		G.add_edge(
			e["doctype"], e["target"],
			src_field=e["fieldname"], tgt_field="name",
			label=e["label"],
		)

	try:
		path = nx.shortest_path(G, source=src_doctype, target=tgt_doctype)
	except (nx.NetworkXNoPath, nx.NodeNotFound):
		return []

	# Permission check: only intermediate nodes (src + tgt already checked)
	for dt in path[1:-1]:
		try:
			if not frappe.has_permission(dt, "read"):
				return []
		except Exception:
			return []

	hops = []
	for i in range(len(path) - 1):
		ed = G.get_edge_data(path[i], path[i + 1]) or {}
		hops.append(dict(
			from_doctype=path[i], to_doctype=path[i + 1],
			src_field=ed.get("src_field", "name"),
			tgt_field=ed.get("tgt_field", "name"),
			via_label=ed.get("label", ""),
		))
	return hops


@frappe.whitelist()
def mine_join_patterns(
	base_doctype: str,
	join_config: str,
	min_support: float = 0.1,
	min_confidence: float = 0.5,
) -> list:
	"""
	Discover association rules in the joined dataset using mlxtend Apriori.

	Fetches ≤500 rows, selects categorical columns (cardinality 2–30),
	one-hot encodes them, runs Apriori (min_support, max_len=3),
	filters by confidence ≥ min_confidence and lift ≥ 1.2.

	Returns top 20 rules [{antecedents, consequents, support, confidence, lift}].
	"""
	from mlxtend.frequent_patterns import apriori, association_rules
	import pandas as pd

	frappe.has_permission(base_doctype, "read", throw=True)

	cfg  = frappe.parse_json(join_config)
	rows = get_joined_data(base_doctype, frappe.as_json(cfg), limit=500)
	if len(rows) < 10:
		return []

	df      = pd.DataFrame(rows).drop(columns=["name"], errors="ignore")
	cat_cols = [c for c in df.columns if 2 <= int(df[c].nunique()) <= 30]
	if len(cat_cols) < 2:
		return []

	df_ohe = pd.get_dummies(
		df[cat_cols].fillna("(blank)").astype(str), prefix_sep="="
	).astype(bool)

	try:
		freq  = apriori(
			df_ohe, min_support=float(min_support), use_colnames=True, max_len=3
		)
		if freq.empty:
			return []
		rules = association_rules(
			freq, metric="confidence",
			min_threshold=float(min_confidence),
			num_itemsets=len(freq),
		)
		rules = (
			rules[rules["lift"] >= 1.2]
			.sort_values("lift", ascending=False)
			.head(20)
		)
	except Exception:
		return []

	return [
		dict(
			antecedents=list(r["antecedents"]),
			consequents=list(r["consequents"]),
			support=round(float(r["support"]), 3),
			confidence=round(float(r["confidence"]), 3),
			lift=round(float(r["lift"]), 2),
		)
		for _, r in rules.iterrows()
	]


def _safe_identifier(name: str) -> str:
	"""
	Validate a Frappe fieldname/doctype for use as a SQL identifier (backtick-quoted).
	Frappe fieldnames are always lowercase alphanumeric + underscore.
	Raises if the name contains unexpected characters.
	"""
	import re
	if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_ ]*$', name):
		frappe.throw(f"Invalid identifier for SQL: {name!r}")
	return name


@frappe.whitelist()
def get_joined_data(base_doctype: str, join_config: str, limit: int = 1000) -> list:
	"""
	Execute dynamic LEFT JOINs from join_config and return flat rows.

	join_config JSON structure:
	  {
	    "base_doctype": "User",
	    "base_names": ["user1", "user2", ...],   // optional: filter to loaded rows
	    "nodes": [{"id": "node_0", "doctype": "User"}, ...],
	    "edges": [{
	      "src_node_id": "node_0", "src_field": "name",
	      "tgt_node_id": "node_1", "tgt_field": "user_id",
	      "selected_fields": ["department", "company"]
	    }, ...]
	  }

	Joined fields are aliased as "{TargetDoctype}__{fieldname}" in the result rows.
	All field/table names are backtick-quoted after identifier validation —
	never wrapped in frappe.db.escape() (which adds string-literal quotes, not identifier quotes).

	Security: frappe.has_permission() is checked for every DocType in the join.
	"""
	join_config = frappe.parse_json(join_config)
	frappe.has_permission(base_doctype, "read", throw=True)

	nodes = {n["id"]: n for n in join_config.get("nodes", [])}
	edges = join_config.get("edges", [])

	if not nodes:
		frappe.throw(_("join_config must contain at least one node"))

	# ── SQL building ──────────────────────────────────────────────────────────

	select_parts = ["`t0`.`name`"]
	joins_sql    = ""
	node_alias   = {join_config["nodes"][0]["id"]: "t0"}

	for i, edge in enumerate(edges, start=1):
		alias    = f"t{i}"
		tgt_node = nodes.get(edge.get("tgt_node_id", ""))
		if not tgt_node:
			continue
		tgt_dt = tgt_node["doctype"]
		frappe.has_permission(tgt_dt, "read", throw=True)

		src_alias = node_alias.get(edge.get("src_node_id", ""), "t0")
		node_alias[edge["tgt_node_id"]] = alias

		# Backtick-quote field identifiers (NOT frappe.db.escape which adds string quotes)
		for field in edge.get("selected_fields", []):
			safe_field = _safe_identifier(field)
			col_alias  = f"{tgt_dt}__{safe_field}"   # e.g. "Employee__date_of_birth"
			select_parts.append(f"`{alias}`.`{safe_field}` AS `{col_alias}`")

		src_f = _safe_identifier(edge.get("src_field", "name"))
		tgt_f = _safe_identifier(edge.get("tgt_field", "name"))
		joins_sql += (
			f"\nLEFT JOIN `tab{tgt_dt}` `{alias}`"
			f" ON `{src_alias}`.`{src_f}` = `{alias}`.`{tgt_f}`"
		)

	# ── Optional WHERE filter: restrict to the names already loaded in the grid ──
	# This ensures Apply returns exactly the rows the user sees, regardless of limit.
	where_sql  = ""
	where_vals = ()
	base_names = join_config.get("base_names") or []
	if base_names:
		placeholders = ", ".join(["%s"] * len(base_names))
		where_sql  = f"\nWHERE `t0`.`name` IN ({placeholders})"
		where_vals = tuple(base_names)

	sql = (
		f"SELECT {', '.join(select_parts)}"
		f"\nFROM `tab{base_doctype}` `t0`"
		f"{joins_sql}"
		f"{where_sql}"
		f"\nLIMIT {frappe.utils.cint(limit)}"
	)
	return frappe.db.sql(sql, values=where_vals or None, as_dict=True)
