"""
Data-Aware Insights for GenBI.

Provides row counts, empty table detection, cardinality warnings,
and estimated result sizes for join paths.
"""

import frappe


class DataInsights:
	"""Provides data-aware suggestions and warnings for join paths."""

	def check_path_data(self, path: list[str], edges: list[dict]) -> dict:
		"""
		Check if a path has actual data in joined tables.

		Args:
		    path: List of DocType names in the path
		    edges: List of edge metadata dictionaries

		Returns:
		    {
		        "has_data": bool,
		        "row_counts": {doctype: int},
		        "empty_tables": [str],
		        "cardinality_warnings": [str],
		        "estimated_result_rows": int
		    }
		"""
		row_counts = {}
		empty_tables = []

		# Check row count for each DocType in path
		for doctype in path:
			try:
				count = frappe.db.count(doctype)
				row_counts[doctype] = count
				if count == 0:
					empty_tables.append(doctype)
			except Exception:
				# DocType might not exist or no permission
				row_counts[doctype] = 0
				empty_tables.append(doctype)

		# Cardinality analysis
		cardinality_warnings = []
		for edge in edges:
			from_dt = edge.get("from")
			to_dt = edge.get("to")
			src_field = edge.get("src_field")
			tgt_field = edge.get("tgt_field")

			if not all([from_dt, to_dt, src_field, tgt_field]):
				continue

			# Check for 1:N explosions
			try:
				if src_field == "name" and tgt_field != "name":
					# Reverse: to_dt.tgt_field → from_dt.name
					# Check if tgt_field has many duplicates (1:N)
					sample = frappe.db.sql(
						f"""
						SELECT `{tgt_field}`, COUNT(*) as cnt
						FROM `tab{to_dt}`
						WHERE `{tgt_field}` IS NOT NULL
						GROUP BY `{tgt_field}`
						ORDER BY cnt DESC
						LIMIT 1
					""",
						as_dict=True,
					)

					if sample and sample[0]["cnt"] > 100:
						cardinality_warnings.append(
							f"⚠️ **{to_dt}.{tgt_field}** → **{from_dt}** is a 1:N relationship "
							f"with up to {sample[0]['cnt']} records per {from_dt}. Result may be large."
						)

				elif tgt_field == "name" and src_field != "name":
					# Forward: from_dt.src_field → to_dt.name
					# Usually 1:1 or N:1, check for N:M via child tables
					from_meta = frappe.get_meta(from_dt)
					if from_meta.istable:
						# Child table source = potential explosion
						parent_count = row_counts.get(from_meta.module, row_counts.get(from_dt, 0))
						if parent_count > 0:
							avg_children = row_counts.get(from_dt, 0) / max(parent_count, 1)
							if avg_children > 5:
								cardinality_warnings.append(
									f"⚠️ **{from_dt}** is a child table with ~{int(avg_children)} "
									f"rows per parent. This may multiply your result size."
								)

			except Exception:
				# Skip if SQL fails
				pass

		# Estimate final result rows (conservative: minimum of all table sizes)
		estimated_rows = min(row_counts.values()) if row_counts else 0

		return {
			"has_data": len(empty_tables) == 0,
			"row_counts": row_counts,
			"empty_tables": empty_tables,
			"cardinality_warnings": cardinality_warnings,
			"estimated_result_rows": estimated_rows,
		}

	def suggest_filters(self, doctype: str) -> list[dict]:
		"""
		Suggest common filters for a DocType based on meta.

		Args:
		    doctype: DocType name

		Returns:
		    [{"field": str, "label": str, "type": str, "options": [str]}]
		"""
		try:
			meta = frappe.get_meta(doctype)
		except Exception:
			return []

		suggestions = []

		# Status fields
		for field in meta.fields:
			if field.fieldtype == "Select" and "status" in field.fieldname.lower():
				# Get actual values from data
				try:
					values = frappe.db.sql(
						f"""
						SELECT DISTINCT `{field.fieldname}`
						FROM `tab{doctype}`
						WHERE `{field.fieldname}` IS NOT NULL
						LIMIT 10
					""",
						pluck=True,
					)

					if values:
						suggestions.append(
							{
								"field": field.fieldname,
								"label": field.label or field.fieldname,
								"type": "Select",
								"options": values,
							}
						)
				except Exception:
					pass

		return suggestions

	def get_row_distribution(self, doctype: str, group_by_field: str) -> list[dict]:
		"""
		Get row count distribution grouped by a field.

		Args:
		    doctype: DocType name
		    group_by_field: Field to group by

		Returns:
		    [{"value": str, "count": int}] sorted by count desc
		"""
		try:
			results = frappe.db.sql(
				f"""
				SELECT `{group_by_field}` as value, COUNT(*) as count
				FROM `tab{doctype}`
				WHERE `{group_by_field}` IS NOT NULL
				GROUP BY `{group_by_field}`
				ORDER BY count DESC
				LIMIT 20
			""",
				as_dict=True,
			)
			return results
		except Exception:
			return []
