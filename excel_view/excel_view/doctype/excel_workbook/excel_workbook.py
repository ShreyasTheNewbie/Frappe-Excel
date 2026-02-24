# Copyright (c) 2026, Ujjwal Aggrawal and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class ExcelWorkbook(Document):
	def before_insert(self):
		# Always set owner to the creating user — never trust the client.
		self.owner = frappe.session.user

	def before_delete(self):
		# Only the owner or a System Manager may delete a workbook.
		if frappe.session.user != self.owner and not frappe.has_role("System Manager"):
			frappe.throw(_("You can only delete your own saved views."))
