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
	Raises PermissionError if the caller is neither the owner nor the workbook
	is public.
	"""
	doc = frappe.get_doc("Excel Workbook", name)

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
