# Copyright (c) 2026, Dipesh Patel and contributors
# For license information, please see license.txt

"""
Real-time helper functions for Canvas Session collaboration.
These functions publish events to Socket.IO clients via Frappe's realtime API.
"""

import frappe
import json


def publish_canvas_update(session_id, canvas_state=None, user=None, timestamp=None):
	"""
	Publish canvas state update to all connected clients in the session

	Args:
		session_id: Canvas session ID
		canvas_state: Full canvas state (dict with nodes, edges, etc.)
		user: User who made the change
		timestamp: Timestamp of change (milliseconds since epoch)
	"""
	if not user:
		user = frappe.session.user

	if not timestamp:
		import time
		timestamp = int(time.time() * 1000)  # Milliseconds since epoch

	full_name = frappe.utils.get_fullname(user)

	# Use Frappe's standard doc room format to match doc_subscribe pattern
	room = f"doc:Canvas Session/{session_id}"

	# Publish to Socket.IO room
	frappe.publish_realtime(
		event="canvas_updated",
		message={
			"session_id": session_id,
			"canvas_state": canvas_state,
			"user": user,
			"full_name": full_name,
			"timestamp": timestamp
		},
		room=room
	)


def publish_chat_message(session_id, message_data):
	"""
	Publish chat message to all clients in the session

	Args:
		session_id: Canvas session ID
		message_data: Dict with {id, user, full_name, image, message, timestamp}
	"""
	frappe.publish_realtime(
		event="chat_message_received",
		message=message_data,
		room=f"canvas_{session_id}",
		after_commit=False
	)


def publish_sticky_note_event(session_id, event_type, note_data):
	"""
	Publish sticky note event (added/updated/deleted)

	Args:
		session_id: Canvas session ID
		event_type: "sticky_note_added", "sticky_note_updated", or "sticky_note_deleted"
		note_data: Note data dict
	"""
	frappe.publish_realtime(
		event=event_type,
		message=note_data,
		room=f"canvas_{session_id}",
		after_commit=False
	)


def publish_user_joined(session_id, user_info):
	"""
	Notify all clients that a user joined the session

	Args:
		session_id: Canvas session ID
		user_info: Dict with {user, full_name, image}
	"""
	frappe.publish_realtime(
		event="user_joined",
		message=user_info,
		room=f"canvas_{session_id}",
		after_commit=False
	)


def publish_user_left(session_id, user):
	"""
	Notify all clients that a user left the session

	Args:
		session_id: Canvas session ID
		user: Username that left
	"""
	frappe.publish_realtime(
		event="user_left",
		message={"user": user},
		room=f"canvas_{session_id}",
		after_commit=False
	)


@frappe.whitelist()
def get_user_info():
	"""
	Get current user information for Socket.IO authentication
	Used by Frappe's Socket.IO middleware
	"""
	user = frappe.session.user

	if user == "Guest":
		frappe.throw("Please login to use collaborative features")

	user_doc = frappe.get_cached_doc("User", user)

	return {
		"user": user,
		"user_type": user_doc.user_type,
		"full_name": user_doc.full_name or user,
		"image": user_doc.user_image
	}


@frappe.whitelist()
def validate_session_access(session_id):
	"""
	Validate if current user has access to the canvas session
	Called by Socket.IO middleware before allowing connection

	Returns: {"has_access": bool, "role": "owner"/"editor"/"viewer"/"public"}
	"""
	try:
		doc = frappe.get_doc("Canvas Session", session_id)
		user = frappe.session.user

		# Owner always has access
		if doc.owner == user:
			return {"has_access": True, "role": "owner"}

		# Check if public
		if doc.is_public:
			return {"has_access": True, "role": "public"}

		# Check collaborators
		for collab in doc.collaborators:
			if collab.user == user:
				role = "editor" if collab.role == "Editor" else "viewer"
				return {"has_access": True, "role": role}

		return {"has_access": False, "role": None}

	except frappe.DoesNotExistError:
		frappe.throw(f"Canvas Session {session_id} not found")
	except Exception as e:
		frappe.log_error(f"Error validating session access: {str(e)}")
		return {"has_access": False, "role": None}
