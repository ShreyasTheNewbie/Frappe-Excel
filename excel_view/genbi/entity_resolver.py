"""
Entity Resolution for GenBI.

Enhanced entity extraction with disambiguation, exact match priority,
and pronoun resolution.
"""

from typing import Optional

import frappe

# Lazy imports
_nlp = None
_embedder = None
_doctype_embeddings = None


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


def _ensure_embedder_loaded():
	"""Lazy load sentence-transformers (only once)."""
	global _embedder

	if _embedder is not None:
		return

	try:
		from sentence_transformers import SentenceTransformer

		_embedder = SentenceTransformer("all-MiniLM-L6-v2")
	except ImportError:
		raise ImportError("sentence-transformers not installed. Run: bench pip install sentence-transformers")


def _get_doctype_embeddings() -> dict:
	"""Get or compute cached DocType embeddings."""
	global _doctype_embeddings

	if _doctype_embeddings is not None:
		return _doctype_embeddings

	# Try loading from cache
	cache_key = "genbi_doctype_embeddings_v1"
	cached = frappe.cache.get_value(cache_key)

	if cached:
		import json

		_doctype_embeddings = json.loads(cached)
		return _doctype_embeddings

	# Compute embeddings for all DocTypes
	_ensure_embedder_loaded()

	all_doctypes = frappe.get_all("DocType", filters={"issingle": 0, "is_virtual": 0}, pluck="name")

	embeddings = {}
	for doctype in all_doctypes:
		embedding = _embedder.encode(doctype.lower(), convert_to_tensor=False)
		embeddings[doctype] = embedding.tolist()  # Convert to list for JSON serialization

	# Cache for 24 hours
	import json

	frappe.cache.set_value(cache_key, json.dumps(embeddings), expires_in_sec=86400)

	_doctype_embeddings = embeddings
	return _doctype_embeddings


class EntityResolver:
	"""Enhanced entity extraction with disambiguation."""

	def __init__(self):
		"""Initialize entity resolver."""
		self.all_doctypes = frappe.get_all(
			"DocType", filters={"issingle": 0, "is_virtual": 0}, pluck="name"
		)
		self.doctype_lower_map = {dt.lower(): dt for dt in self.all_doctypes}

	def extract_entities(
		self, query: str, conversation_context: Optional[dict] = None
	) -> list[dict]:
		"""
		Extract DocType entities from query.

		Args:
		    query: User's natural language query
		    conversation_context: Optional conversation context for pronoun resolution

		Returns:
		    [{
		        "doctype": str,
		        "confidence": float,
		        "matched_span": str,
		        "is_exact": bool,
		        "alternatives": [str]
		    }]
		"""
		matches = []

		# Phase 1: Pronoun resolution
		if conversation_context:
			pronouns = ["it", "that", "this", "them", "those"]
			if any(p in query.lower() for p in pronouns):
				last_entities = conversation_context.get("last_entities", [])
				if last_entities:
					matches.append(
						{
							"doctype": last_entities[0],
							"confidence": 0.95,
							"matched_span": "[pronoun]",
							"is_exact": False,
							"alternatives": [],
						}
					)
					return matches

		# Phase 2: Exact match check (fast path)
		query_lower = query.lower()
		for dt_lower, dt in self.doctype_lower_map.items():
			if dt_lower in query_lower:
				matches.append(
					{
						"doctype": dt,
						"confidence": 1.0,
						"matched_span": dt,
						"is_exact": True,
						"alternatives": [],
					}
				)

		if matches:
			return matches

		# Phase 3: Fuzzy + semantic matching
		candidates = self._fuzzy_semantic_match(query, threshold=0.7)

		if len(candidates) == 1:
			# Single best match
			matches.append(
				{
					"doctype": candidates[0]["doctype"],
					"confidence": candidates[0]["score"],
					"matched_span": query,
					"is_exact": False,
					"alternatives": [],
				}
			)
		elif len(candidates) > 1:
			# Multiple matches - needs disambiguation
			matches.append(
				{
					"doctype": candidates[0]["doctype"],  # Best guess
					"confidence": candidates[0]["score"],
					"matched_span": query,
					"is_exact": False,
					"alternatives": [c["doctype"] for c in candidates[1:3]],  # Top 2 alternatives
				}
			)

		return matches

	def _fuzzy_semantic_match(self, query: str, threshold: float = 0.7) -> list[dict]:
		"""
		Combine RapidFuzz + sentence-transformers for better matching.

		Args:
		    query: Query text
		    threshold: Minimum composite score

		Returns:
		    [{"doctype": str, "score": float}] sorted by score desc
		"""
		from rapidfuzz import fuzz, process

		# Fuzzy match
		fuzzy_results = process.extract(
			query.lower(), [dt.lower() for dt in self.all_doctypes], scorer=fuzz.token_sort_ratio, limit=5
		)

		# Semantic similarity boost
		_ensure_embedder_loaded()
		import torch

		query_embedding = _embedder.encode(query.lower(), convert_to_tensor=True)

		candidates = []
		for doctype_lower, fuzzy_score, _ in fuzzy_results:
			doctype = self.doctype_lower_map[doctype_lower]

			# Get cached embedding
			dt_embeddings = _get_doctype_embeddings()
			if doctype in dt_embeddings:
				dt_embedding = torch.tensor(dt_embeddings[doctype])
				semantic_score = torch.nn.functional.cosine_similarity(
					query_embedding.unsqueeze(0), dt_embedding.unsqueeze(0)
				).item()
			else:
				semantic_score = 0.0

			# Composite: 60% fuzzy + 40% semantic
			composite = 0.6 * (fuzzy_score / 100) + 0.4 * semantic_score

			if composite >= threshold:
				candidates.append({"doctype": doctype, "score": round(composite, 2)})

		return sorted(candidates, key=lambda x: -x["score"])
