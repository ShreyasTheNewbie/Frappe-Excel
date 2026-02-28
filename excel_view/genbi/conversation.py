"""
Conversation State Management for GenBI.

Manages multi-turn conversation context with Redis persistence.
"""

import json
from typing import Optional

import frappe


class ConversationState:
	"""Manages multi-turn conversation context for GenBI chat."""

	def __init__(self, session_id: str, base_doctype: str):
		"""
		Initialize conversation state.

		Args:
		    session_id: Unique session ID for this conversation
		    base_doctype: Starting DocType (current Excel View DocType)
		"""
		self.session_id = session_id
		self.base_doctype = base_doctype
		self.history = []  # [{role: "user"/"bot", message: str, intent: str, entities: [...]}]
		self.context = {
			"last_entities": [],  # Recently mentioned DocTypes
			"last_paths": [],  # Recent path suggestions
			"canvas_state": None,  # Current canvas if auto-built
			"follow_up_mode": None,  # "refine", "explain", "build"
		}

	@classmethod
	def load(cls, session_id: str, base_doctype: str) -> "ConversationState":
		"""
		Load conversation state from Redis or create new.

		Args:
		    session_id: Session ID
		    base_doctype: Base DocType

		Returns:
		    ConversationState instance
		"""
		cache_key = f"genbi_conversation:{session_id}"
		cached_data = frappe.cache.get_value(cache_key)

		if cached_data:
			try:
				data = json.loads(cached_data)
				conv = cls(session_id, base_doctype)
				conv.history = data.get("history", [])
				conv.context = data.get("context", conv.context)
				return conv
			except (json.JSONDecodeError, KeyError):
				# Corrupted cache, start fresh
				pass

		# Create new conversation
		return cls(session_id, base_doctype)

	def save(self) -> None:
		"""Save conversation state to Redis with 1-hour TTL."""
		cache_key = f"genbi_conversation:{self.session_id}"
		data = {"history": self.history, "context": self.context}
		frappe.cache.set_value(cache_key, json.dumps(data), expires_in_sec=3600)  # 1 hour

	def add_turn(
		self,
		role: str,
		message: str | dict,
		intent: Optional[str] = None,
		entities: Optional[list] = None,
	) -> None:
		"""
		Add conversation turn with metadata.

		Args:
		    role: "user" or "bot"
		    message: Message content (str for user, dict for bot response)
		    intent: Classified intent (optional)
		    entities: Extracted entities (optional)
		"""
		turn = {"role": role, "message": message, "timestamp": frappe.utils.now()}

		if intent:
			turn["intent"] = intent
		if entities:
			turn["entities"] = entities
			# Update last_entities context
			self.context["last_entities"] = [e["doctype"] for e in entities if "doctype" in e]

		self.history.append(turn)

		# Keep only last 20 turns to limit memory
		if len(self.history) > 20:
			self.history = self.history[-20:]

	def get_recent_context(self, n: int = 3) -> list:
		"""
		Get last N turns for context window.

		Args:
		    n: Number of recent turns to return

		Returns:
		    List of recent turns
		"""
		return self.history[-n:] if self.history else []

	def resolve_pronoun(self, text: str) -> Optional[str]:
		"""
		Resolve pronouns ('it', 'that', 'this') to last entity.

		Args:
		    text: Query text

		Returns:
		    Last mentioned DocType or None
		"""
		pronouns = ["it", "that", "this", "them", "those"]
		text_lower = text.lower()

		if any(p in text_lower for p in pronouns):
			if self.context.get("last_entities"):
				return self.context["last_entities"][0]

		return None

	def clear(self) -> None:
		"""Clear conversation history and context."""
		self.history = []
		self.context = {
			"last_entities": [],
			"last_paths": [],
			"canvas_state": None,
			"follow_up_mode": None,
		}
		# Remove from cache
		frappe.cache.delete_value(f"genbi_conversation:{self.session_id}")
