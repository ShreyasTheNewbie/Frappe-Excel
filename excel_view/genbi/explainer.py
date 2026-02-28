"""
Relationship Explanation Engine for GenBI.

Generates human-readable explanations of join paths with business context.
"""

import frappe


class RelationshipExplainer:
	"""Explains why DocTypes are connected and provides business context."""

	# Common business flow patterns
	COMMON_FLOWS = {
		("Lead", "Customer", "Sales Order"): "Sales funnel: tracking leads through conversion to orders",
		("Lead", "Customer"): "Sales funnel: lead conversion to customer",
		("Customer", "Sales Order", "Sales Invoice"): "Sales cycle: orders to invoicing",
		("Employee", "Timesheet", "Project"): "Project time tracking: employee hours logged against projects",
		("User", "Employee", "Salary Slip"): "Payroll: system users linked to employee records and salary processing",
		("Project", "Task", "Timesheet"): "Project management: tasks and time tracking",
		("Item", "BOM", "Work Order"): "Manufacturing: bill of materials to production",
		("Sales Order", "Delivery Note", "Sales Invoice"): "Order fulfillment: delivery and billing",
	}

	# Weird intermediate DocTypes to penalize
	WEIRD_DOCTYPES = {
		"Currency",
		"Asset",
		"Dunning",
		"Communication Medium",
		"Web Template",
		"UOM",
		"Country",
		"Territory",
		"Price List",
		"Warehouse Type",
		"Cost Center",
		"Fiscal Year",
	}

	# Common business entities
	GOOD_DOCTYPES = {
		"User",
		"Employee",
		"Project",
		"Task",
		"Department",
		"Company",
		"Timesheet",
		"Salary Slip",
		"Attendance",
		"Sales Order",
		"Sales Invoice",
		"Purchase Order",
		"Purchase Invoice",
		"Customer",
		"Supplier",
		"Item",
	}

	def explain_path(self, path: list[str], edges_metadata: list[dict]) -> dict:
		"""
		Generate human-readable explanation of a join path.

		Args:
		    path: List of DocType names in path (e.g., ["Lead", "Customer", "Sales Order"])
		    edges_metadata: List of edge dicts with keys: from, to, src_field, tgt_field, method, etc.

		Returns:
		    {
		        "summary": str,
		        "steps": [str],
		        "business_context": str,
		        "confidence_reasoning": str
		    }
		"""
		explanations = []

		for edge in edges_metadata:
			from_dt = edge.get("from")
			to_dt = edge.get("to")
			src_field = edge.get("src_field")
			tgt_field = edge.get("tgt_field")
			method = edge.get("method")
			is_child_src = edge.get("is_child_src")
			is_dynamic = edge.get("is_dynamic")

			explanation = self._explain_edge(
				from_dt, to_dt, src_field, tgt_field, method, is_child_src, is_dynamic
			)
			explanations.append(explanation)

		# Business context inference
		business_context = self._infer_business_context(path)

		# Confidence reasoning
		confidence_reasoning = self._explain_confidence(edges_metadata)

		hop_count = len(path) - 1
		summary = (
			f"Path from **{path[0]}** to **{path[-1]}** "
			f"via {hop_count - 1} intermediate {'step' if hop_count == 2 else 'steps'}."
			if hop_count > 1
			else f"Direct connection from **{path[0]}** to **{path[-1]}**."
		)

		return {
			"summary": summary,
			"steps": explanations,
			"business_context": business_context,
			"confidence_reasoning": confidence_reasoning,
		}

	def _explain_edge(
		self,
		from_dt: str,
		to_dt: str,
		src_field: str,
		tgt_field: str,
		method: str = None,
		is_child_src: bool = False,
		is_dynamic: bool = False,
	) -> str:
		"""Explain a single edge."""
		# Get field metadata for better labels
		src_label = self._get_field_label(from_dt, src_field)
		tgt_label = self._get_field_label(to_dt, tgt_field)

		# Meta Link (best quality)
		if method == "meta" or (not method and not is_dynamic):
			if src_field == "name" and tgt_field != "name":
				# Reverse Link: to_dt.tgt_field → from_dt.name
				return (
					f"**{to_dt}** has a Link field **{tgt_label}** that references **{from_dt}**. "
					f"This creates a many-to-one relationship: multiple {to_dt} records can point to the same {from_dt}."
				)

			elif tgt_field == "name" and src_field != "name":
				# Forward Link: from_dt.src_field → to_dt.name
				return (
					f"**{from_dt}** has a Link field **{src_label}** that points to **{to_dt}**. "
					f"Each {from_dt} record can reference one {to_dt} record."
				)

			elif src_field == "parent" or is_child_src:
				# Child table parent link
				return (
					f"**{from_dt}** is a child table (line items) of **{to_dt}**. "
					f"Each {from_dt} row belongs to one parent {to_dt} record via the 'parent' field."
				)

			else:
				# Generic meta link
				return (
					f"**{from_dt}** and **{to_dt}** are connected via Link fields "
					f"**{src_label}** and **{tgt_label}**."
				)

		# Dynamic Link
		elif is_dynamic:
			return (
				f"**{from_dt}** has a Dynamic Link field that can reference multiple DocTypes, "
				f"including **{to_dt}**. This is a polymorphic relationship (e.g., Comments linking to various documents)."
			)

		# ML-suggested join
		else:
			confidence_pct = int(edge.get("confidence", 0.5) * 100) if isinstance(edge, dict) else 50
			return (
				f"**{from_dt}.{src_label}** and **{to_dt}.{tgt_label}** were matched using AI "
				f"based on field name similarity and data patterns. "
				f"This is an inferred relationship with {confidence_pct}% confidence."
			)

	def _get_field_label(self, doctype: str, fieldname: str) -> str:
		"""Get field label from meta, fallback to fieldname."""
		try:
			meta = frappe.get_meta(doctype)
			field = meta.get_field(fieldname)
			return field.label if field and field.label else fieldname
		except Exception:
			return fieldname

	def _infer_business_context(self, path: list[str]) -> str:
		"""Infer business use case from path."""
		path_tuple = tuple(path)

		# Check exact match
		if path_tuple in self.COMMON_FLOWS:
			return self.COMMON_FLOWS[path_tuple]

		# Check partial matches
		for flow_path, context in self.COMMON_FLOWS.items():
			if all(dt in path for dt in flow_path):
				return context

		# Generic inference based on keywords
		path_str = " ".join(path)

		if "Employee" in path_str and ("Salary" in path_str or "Payroll" in path_str):
			return "HR/Payroll workflow"
		elif any(word in path_str for word in ["Sales", "Customer", "Invoice", "Order"]):
			return "Sales/CRM workflow"
		elif any(word in path_str for word in ["Project", "Task", "Timesheet"]):
			return "Project management workflow"
		elif any(word in path_str for word in ["Purchase", "Supplier", "Item"]):
			return "Procurement workflow"
		elif any(word in path_str for word in ["Manufacturing", "BOM", "Work Order"]):
			return "Manufacturing workflow"
		else:
			return "Custom business workflow"

	def _explain_confidence(self, edges_metadata: list[dict]) -> str:
		"""Explain why this path has its confidence score."""
		meta_count = sum(1 for e in edges_metadata if e.get("method") == "meta")
		total_edges = len(edges_metadata)

		if meta_count == total_edges:
			return "All connections are based on Link fields defined in your DocType schemas (highest confidence)."
		elif meta_count > 0:
			return (
				f"{meta_count} of {total_edges} connections are schema-defined Link fields. "
				f"The rest are AI-inferred based on field names and data patterns."
			)
		else:
			return "All connections are AI-inferred based on field name similarity and data analysis."

	def compare_paths(self, path1: dict, path2: dict) -> str:
		"""
		Compare two paths and recommend which is better.

		Args:
		    path1: First path dict with keys: path, edges, confidence
		    path2: Second path dict with keys: path, edges, confidence

		Returns:
		    Explanation string
		"""
		p1_len = len(path1["path"])
		p2_len = len(path2["path"])
		p1_conf = path1.get("confidence", 0.5)
		p2_conf = path2.get("confidence", 0.5)

		reasons = []

		# Compare length
		if p1_len < p2_len:
			reasons.append(f"Path 1 is shorter ({p1_len} vs {p2_len} DocTypes)")
		elif p2_len < p1_len:
			reasons.append(f"Path 2 is shorter ({p2_len} vs {p1_len} DocTypes)")

		# Compare confidence
		if p1_conf > p2_conf:
			reasons.append(f"Path 1 has higher confidence ({int(p1_conf*100)}% vs {int(p2_conf*100)}%)")
		elif p2_conf > p1_conf:
			reasons.append(f"Path 2 has higher confidence ({int(p2_conf*100)}% vs {int(p1_conf*100)}%)")

		# Compare edge quality
		p1_meta = sum(1 for e in path1["edges"] if e.get("method") == "meta")
		p2_meta = sum(1 for e in path2["edges"] if e.get("method") == "meta")

		if p1_meta > p2_meta:
			reasons.append(f"Path 1 has more schema-defined links ({p1_meta} vs {p2_meta})")
		elif p2_meta > p1_meta:
			reasons.append(f"Path 2 has more schema-defined links ({p2_meta} vs {p1_meta})")

		if not reasons:
			return "Both paths are equally good in terms of length, confidence, and link quality."

		recommendation = "Path 1 is recommended" if p1_conf >= p2_conf else "Path 2 is recommended"
		return f"{recommendation}. " + ". ".join(reasons) + "."
