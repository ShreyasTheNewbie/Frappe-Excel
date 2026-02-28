"""
Query Parsing for GenBI.

Parses complex natural language queries into structured canvas configurations
using spaCy dependency parsing.

Example queries:
- "employee salary with deductions grouped by department"
- "sales orders with items where customer is in India"
- "project tasks assigned to users, show task status and user name"
"""

from typing import Optional

import frappe

# Lazy imports
_nlp = None


def _ensure_nlp_loaded():
	"""Lazy load spaCy NLP model (only once)."""
	global _nlp

	if _nlp is not None:
		return

	try:
		import spacy

		# Load lightweight English model
		_nlp = spacy.load("en_core_web_sm")
	except (ImportError, OSError):
		raise ImportError(
			"spaCy or model not installed. "
			"Run: bench pip install spacy && python -m spacy download en_core_web_sm"
		)


class QueryParser:
	"""Parses complex queries into canvas configurations."""

	def __init__(self):
		"""Initialize query parser."""
		self.all_doctypes = frappe.get_all(
			"DocType", filters={"issingle": 0, "is_virtual": 0}, pluck="name"
		)
		self.doctype_lower_map = {dt.lower(): dt for dt in self.all_doctypes}

	def parse(self, query: str, base_doctype: str) -> Optional[dict]:
		"""
		Parse complex query into canvas configuration.

		Args:
		    query: Natural language query
		    base_doctype: Starting DocType (current Excel View DocType)

		Returns:
		    {
		        "entities": [str],  # Ordered list of DocTypes in join path
		        "fields": {doctype: [str]},  # Fields to show per DocType
		        "filters": [{doctype: str, field: str, operator: str, value: str}],
		        "group_by": {doctype: str, field: str},
		        "aggregates": [{field: str, function: str}],
		        "confidence": float,
		        "parsing_notes": str
		    }
		"""
		_ensure_nlp_loaded()

		doc = _nlp(query.lower())

		# Extract entities (DocTypes mentioned)
		entities = self._extract_entities_ordered(query, base_doctype)

		if not entities:
			return None

		# Extract field mentions
		fields = self._extract_field_mentions(doc, entities)

		# Extract filters (where clauses)
		filters = self._extract_filters(doc, entities)

		# Extract grouping
		group_by = self._extract_group_by(doc, entities)

		# Extract aggregates
		aggregates = self._extract_aggregates(doc, entities)

		# Confidence based on parse completeness
		confidence = self._calculate_confidence(entities, fields, filters, group_by, aggregates)

		parsing_notes = self._generate_parsing_notes(entities, fields, filters, group_by)

		return {
			"entities": entities,
			"fields": fields,
			"filters": filters,
			"group_by": group_by,
			"aggregates": aggregates,
			"confidence": round(confidence, 2),
			"parsing_notes": parsing_notes,
		}

	def _extract_entities_ordered(self, query: str, base_doctype: str) -> list[str]:
		"""
		Extract DocTypes mentioned in query, ordered by appearance.

		Args:
		    query: Query text
		    base_doctype: Starting DocType

		Returns:
		    Ordered list of DocTypes starting with base_doctype
		"""
		query_lower = query.lower()
		entities = [base_doctype]  # Always start with base

		# Multi-word entity detection
		multi_word_entities = [
			"sales order",
			"sales invoice",
			"purchase order",
			"purchase invoice",
			"delivery note",
			"salary slip",
			"work order",
		]

		for entity in multi_word_entities:
			if entity in query_lower:
				doctype = self.doctype_lower_map.get(entity.replace(" ", ""))
				if doctype and doctype not in entities:
					entities.append(doctype)

		# Single-word entities
		for dt_lower, dt in self.doctype_lower_map.items():
			if dt_lower in query_lower and dt not in entities:
				entities.append(dt)

		return entities

	def _extract_field_mentions(self, doc, entities: list[str]) -> dict[str, list[str]]:
		"""
		Extract field names mentioned in query.

		Args:
		    doc: spaCy Doc object
		    entities: List of DocTypes in query

		Returns:
		    {doctype: [fieldname]}
		"""
		fields = {}

		for doctype in entities:
			try:
				meta = frappe.get_meta(doctype)
				mentioned_fields = []

				# Check if any field label/name is mentioned
				for field in meta.fields:
					field_label_lower = (field.label or field.fieldname).lower()
					field_name_lower = field.fieldname.lower()

					for token in doc:
						if token.text in field_label_lower or token.text in field_name_lower:
							if field.fieldname not in mentioned_fields:
								mentioned_fields.append(field.fieldname)

				if mentioned_fields:
					fields[doctype] = mentioned_fields

			except Exception:
				continue

		return fields

	def _extract_filters(self, doc, entities: list[str]) -> list[dict]:
		"""
		Extract filter conditions from query.

		Args:
		    doc: spaCy Doc object
		    entities: List of DocTypes

		Returns:
		    [{doctype: str, field: str, operator: str, value: str}]
		"""
		filters = []

		# Look for "where" keyword
		where_idx = None
		for i, token in enumerate(doc):
			if token.text == "where":
				where_idx = i
				break

		if where_idx is None:
			return filters

		# Extract condition after "where"
		condition_tokens = doc[where_idx + 1 :]

		# Simple pattern: [field] [is/=] [value]
		# Example: "where customer is in India"
		for doctype in entities:
			try:
				meta = frappe.get_meta(doctype)

				for field in meta.fields:
					field_name_lower = field.fieldname.lower()

					for i, token in enumerate(condition_tokens):
						if field_name_lower in token.text:
							# Look for operator and value
							operator = "="
							value = None

							if i + 1 < len(condition_tokens):
								next_token = condition_tokens[i + 1]
								if next_token.text in ["is", "=", "==", "in"]:
									operator = "="
									if i + 2 < len(condition_tokens):
										value = condition_tokens[i + 2].text
								elif next_token.text in [">", "<", ">=", "<="]:
									operator = next_token.text
									if i + 2 < len(condition_tokens):
										value = condition_tokens[i + 2].text

							if value:
								filters.append(
									{
										"doctype": doctype,
										"field": field.fieldname,
										"operator": operator,
										"value": value,
									}
								)

			except Exception:
				continue

		return filters

	def _extract_group_by(self, doc, entities: list[str]) -> Optional[dict]:
		"""
		Extract grouping field from query.

		Args:
		    doc: spaCy Doc object
		    entities: List of DocTypes

		Returns:
		    {doctype: str, field: str} or None
		"""
		# Look for "grouped by" or "group by"
		grouped_idx = None
		for i, token in enumerate(doc):
			if token.text in ["grouped", "group"] and i + 1 < len(doc) and doc[i + 1].text == "by":
				grouped_idx = i + 2
				break

		if grouped_idx is None or grouped_idx >= len(doc):
			return None

		# Extract field after "grouped by"
		group_field_text = doc[grouped_idx].text

		# Find which DocType this field belongs to
		for doctype in entities:
			try:
				meta = frappe.get_meta(doctype)

				for field in meta.fields:
					if field.fieldname.lower() == group_field_text or (
						field.label and field.label.lower() == group_field_text
					):
						return {"doctype": doctype, "field": field.fieldname}

			except Exception:
				continue

		return None

	def _extract_aggregates(self, doc, entities: list[str]) -> list[dict]:
		"""
		Extract aggregate functions from query.

		Args:
		    doc: spaCy Doc object
		    entities: List of DocTypes

		Returns:
		    [{field: str, function: str}]
		"""
		aggregates = []

		# Common aggregate keywords
		agg_keywords = {
			"sum": "Sum",
			"total": "Sum",
			"count": "Count",
			"average": "Avg",
			"avg": "Avg",
			"max": "Max",
			"min": "Min",
		}

		for i, token in enumerate(doc):
			if token.text in agg_keywords:
				function = agg_keywords[token.text]

				# Look for "of [field]"
				if i + 1 < len(doc) and doc[i + 1].text == "of" and i + 2 < len(doc):
					field_text = doc[i + 2].text

					# Find field in entities
					for doctype in entities:
						try:
							meta = frappe.get_meta(doctype)

							for field in meta.fields:
								if field.fieldname.lower() == field_text or (
									field.label and field.label.lower() == field_text
								):
									aggregates.append(
										{
											"doctype": doctype,
											"field": field.fieldname,
											"function": function,
										}
									)
									break

						except Exception:
							continue

		return aggregates

	def _calculate_confidence(
		self,
		entities: list[str],
		fields: dict,
		filters: list,
		group_by: Optional[dict],
		aggregates: list,
	) -> float:
		"""
		Calculate parsing confidence based on completeness.

		Args:
		    entities: Extracted entities
		    fields: Extracted fields
		    filters: Extracted filters
		    group_by: Extracted grouping
		    aggregates: Extracted aggregates

		Returns:
		    Confidence score 0-1
		"""
		score = 0.0

		# Base: entities found
		if entities:
			score += 0.4

		# Fields mentioned
		if fields:
			score += 0.2

		# Filters parsed
		if filters:
			score += 0.15

		# Grouping parsed
		if group_by:
			score += 0.15

		# Aggregates parsed
		if aggregates:
			score += 0.1

		return min(score, 1.0)

	def _generate_parsing_notes(
		self, entities: list[str], fields: dict, filters: list, group_by: Optional[dict]
	) -> str:
		"""
		Generate human-readable parsing summary.

		Args:
		    entities: Extracted entities
		    fields: Extracted fields
		    filters: Extracted filters
		    group_by: Extracted grouping

		Returns:
		    Summary string
		"""
		notes = []

		if entities:
			notes.append(f"Found {len(entities)} DocTypes: {', '.join(entities)}")

		if fields:
			field_count = sum(len(f) for f in fields.values())
			notes.append(f"Extracted {field_count} field mentions")

		if filters:
			notes.append(f"Applied {len(filters)} filter(s)")

		if group_by:
			notes.append(f"Grouped by {group_by['doctype']}.{group_by['field']}")

		return ". ".join(notes) if notes else "Basic entity extraction only."
