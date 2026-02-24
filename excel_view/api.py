# Copyright (c) 2026, Ujjwal Aggrawal and contributors
# For license information, please see license.txt

"""
excel_view.api — server-side endpoints for Saved Workbooks (V2.1).

All methods are @frappe.whitelist(), meaning they are accessible via
frappe.call({ method: "excel_view.api.<name>", ... }) from the client.

Security model:
  - Any logged-in user can create workbooks.
  - A workbook is readable by its owner or by anyone if is_public = 1.
  - Only the owner (or System Manager) can update or delete a workbook.
  - Every method verifies that the caller has READ permission on the target
    DocType — so users can't save views for doctypes they can't access.
"""

import frappe
from frappe import _


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
