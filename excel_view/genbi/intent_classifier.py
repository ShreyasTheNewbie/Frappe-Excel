"""
Intent Classification for GenBI.

Uses sentence-transformers for semantic similarity matching against intent templates.
"""

from typing import Optional

# Lazy imports - loaded only when first chat is opened
_embedder = None
_intent_embeddings = None


def _ensure_model_loaded():
	"""Lazy load sentence-transformers model (only once)."""
	global _embedder, _intent_embeddings

	if _embedder is not None:
		return

	try:
		from sentence_transformers import SentenceTransformer, util

		# Use lightweight model (~80MB)
		_embedder = SentenceTransformer("all-MiniLM-L6-v2")

		# Precompute intent template embeddings
		intent_templates = {
			"FIND_PATH": [
				"connect to",
				"path to",
				"join with",
				"link to",
				"show connection",
				"how to reach",
			],
			"EXPLAIN": [
				"why connected",
				"explain relationship",
				"what does mean",
				"which is better",
				"how are they related",
				"tell me about connection",
			],
			"BUILD_CANVAS": [
				"build canvas",
				"show me",
				"create view",
				"grouped by",
				"with fields",
				"employee salary deductions",
			],
			"SUGGEST": [
				"what can I join",
				"recommend",
				"suggest connections",
				"what else",
				"show options",
			],
			"ANALYZE_DATA": [
				"how many rows",
				"check data",
				"empty tables",
				"row count",
				"has data",
				"cardinality",
			],
			"REFINE": [
				"show me more",
				"exclude",
				"shorter paths",
				"filter",
				"different options",
				"not that one",
			],
		}

		# Compute embeddings for all templates
		_intent_embeddings = {}
		for intent, templates in intent_templates.items():
			# Average embedding of all templates for this intent
			template_embeds = _embedder.encode(templates, convert_to_tensor=True)
			_intent_embeddings[intent] = template_embeds.mean(dim=0)

	except ImportError:
		# sentence-transformers not installed yet
		raise ImportError(
			"sentence-transformers is not installed. "
			"Run: bench pip install sentence-transformers"
		)


class IntentClassifier:
	"""Classifies user query intent using semantic similarity."""

	def __init__(self):
		"""Initialize intent classifier (lazy loads model on first use)."""
		pass

	def classify(self, query: str, conversation_context: Optional[dict] = None) -> tuple[str, float]:
		"""
		Classify user query intent.

		Args:
		    query: User's natural language query
		    conversation_context: Optional conversation context for follow-up detection

		Returns:
		    (intent: str, confidence: float)
		"""
		# Lazy load model
		_ensure_model_loaded()

		from sentence_transformers import util

		# Encode query
		query_embedding = _embedder.encode(query, convert_to_tensor=True)

		best_intent = None
		best_score = 0.0

		# Compare against all intent embeddings
		for intent, intent_embedding in _intent_embeddings.items():
			score = util.cos_sim(query_embedding, intent_embedding).item()
			if score > best_score:
				best_score = score
				best_intent = intent

		# Context boost for follow-up queries
		if conversation_context:
			follow_up_mode = conversation_context.get("follow_up_mode")

			# If last intent was FIND_PATH and user says "explain" → boost EXPLAIN
			if follow_up_mode == "explain" and best_score < 0.7:
				if any(word in query.lower() for word in ["why", "how", "explain", "tell"]):
					best_intent = "EXPLAIN"
					best_score = 0.85

			# If last intent was EXPLAIN and user says "build" → boost BUILD_CANVAS
			if follow_up_mode == "build" and best_score < 0.7:
				if any(word in query.lower() for word in ["build", "create", "show", "make"]):
					best_intent = "BUILD_CANVAS"
					best_score = 0.85

			# Refine mode detection
			if conversation_context.get("last_paths"):
				if any(word in query.lower() for word in ["more", "other", "different", "exclude"]):
					best_intent = "REFINE"
					best_score = 0.9

		# Default to FIND_PATH if confidence too low
		if best_score < 0.4:
			best_intent = "FIND_PATH"
			best_score = 0.5

		return best_intent, round(best_score, 2)
