# Copyright (c) 2026, Dipesh Patel and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
import uuid
import json


class CanvasSession(Document):
	def before_validate(self):
		"""Generate UUID for session_id if not provided - runs before validation"""
		if not self.session_id:
			self.session_id = str(uuid.uuid4())[:8]  # Short UUID for user-friendly URLs

	def before_insert(self):
		"""Initialize fields before inserting"""
		if not self.created_at:
			self.created_at = frappe.utils.now()

		if not self.last_activity:
			self.last_activity = frappe.utils.now()

		# Initialize JSON fields if empty
		if not self.canvas_state:
			self.canvas_state = json.dumps({
				"nodes": [],
				"edges": [],
				"positions": {}
			})

		if not self.chat_messages:
			self.chat_messages = json.dumps([])

	def on_update(self):
		"""Update last_activity timestamp on every save"""
		if not self.flags.skip_last_activity_update:
			frappe.db.set_value(
				"Canvas Session",
				self.name,
				"last_activity",
				frappe.utils.now(),
				update_modified=False
			)

	def has_permission(self, ptype, user=None):
		"""Custom permission check"""
		if not user:
			user = frappe.session.user

		# Owner always has full access
		if self.owner == user:
			return True

		# Public sessions: everyone can read/write
		if self.is_public:
			return True

		# Check if user is in collaborators list
		for collab in self.collaborators:
			if collab.user == user:
				if ptype == "read":
					return True
				elif ptype == "write":
					return collab.role == "Editor"

		return False


@frappe.whitelist()
def create_session(title, base_doctype, canvas_state=None):
	"""Create a new canvas session"""
	# Generate a unique session ID
	session_id = str(uuid.uuid4())[:8]

	doc = frappe.get_doc({
		"doctype": "Canvas Session",
		"session_id": session_id,
		"title": title,
		"base_doctype": base_doctype,
		"canvas_state": canvas_state or json.dumps({
			"nodes": [],
			"edges": [],
			"positions": {}
		}),
		"is_public": 0,  # Sessions are private by default
		"owner": frappe.session.user
	})
	doc.insert()
	frappe.db.commit()

	return {
		"session_id": doc.session_id,
		"name": doc.name,
		"title": doc.title
	}


@frappe.whitelist()
def get_session(session_id):
	"""Get canvas session by ID"""
	try:
		doc = frappe.get_doc("Canvas Session", session_id)

		# Check permission
		if not doc.has_permission("read"):
			frappe.throw("You do not have permission to access this session")

		return {
			"name": doc.name,
			"session_id": doc.session_id,
			"title": doc.title,
			"base_doctype": doc.base_doctype,
			"canvas_state": json.loads(doc.canvas_state) if doc.canvas_state else {},
			"chat_messages": json.loads(doc.chat_messages) if doc.chat_messages else [],
			"is_public": doc.is_public,
			"collaborators": [
				{
					"user": c.user,
					"role": c.role,
					"joined_at": c.joined_at
				}
				for c in doc.collaborators
			],
			"owner": doc.owner,
			"created_at": doc.created_at,
			"creation": doc.creation,
			"last_activity": doc.last_activity
		}
	except frappe.DoesNotExistError:
		frappe.throw(f"Canvas Session {session_id} not found")


@frappe.whitelist()
def update_canvas_state(session_id, canvas_state=None, chat_messages=None, timestamp=None):
	"""Update canvas session state and broadcast to all users"""
	import time
	from excel_view.canvas_session_realtime import publish_canvas_update

	doc = frappe.get_doc("Canvas Session", session_id)

	# Check permission
	if not doc.has_permission("write"):
		frappe.throw("You do not have permission to edit this session")

	# Track if canvas_state was updated (for broadcasting)
	canvas_state_updated = False
	parsed_canvas_state = None

	if canvas_state is not None:
		if isinstance(canvas_state, str):
			canvas_state = json.loads(canvas_state)
		doc.canvas_state = json.dumps(canvas_state)
		canvas_state_updated = True
		parsed_canvas_state = canvas_state

	if chat_messages is not None:
		if isinstance(chat_messages, str):
			chat_messages = json.loads(chat_messages)
		doc.chat_messages = json.dumps(chat_messages)

	doc.save()
	frappe.db.commit()

	# Broadcast canvas state update to all users in session
	if canvas_state_updated:
		if not timestamp:
			timestamp = int(time.time() * 1000)  # Milliseconds since epoch

		publish_canvas_update(
			session_id=session_id,
			canvas_state=parsed_canvas_state,
			user=frappe.session.user,
			timestamp=timestamp
		)

	return {"success": True, "timestamp": timestamp}


@frappe.whitelist()
def add_collaborator(session_id, user, role="Editor"):
	"""Add a collaborator to the session"""
	doc = frappe.get_doc("Canvas Session", session_id)

	# Only owner can add collaborators
	if doc.owner != frappe.session.user:
		frappe.throw("Only the session owner can add collaborators")

	# Check if user already exists
	for collab in doc.collaborators:
		if collab.user == user:
			frappe.throw(f"User {user} is already a collaborator")

	# Add new collaborator
	doc.append("collaborators", {
		"user": user,
		"role": role,
		"joined_at": frappe.utils.now()
	})

	doc.save()
	frappe.db.commit()

	return {"success": True}


@frappe.whitelist()
def remove_collaborator(session_id, user):
	"""Remove a collaborator from the session"""
	doc = frappe.get_doc("Canvas Session", session_id)

	# Only owner can remove collaborators
	if doc.owner != frappe.session.user:
		frappe.throw("Only the session owner can remove collaborators")

	# Find and remove collaborator
	for idx, collab in enumerate(doc.collaborators):
		if collab.user == user:
			doc.collaborators.pop(idx)
			break

	doc.save()
	frappe.db.commit()

	return {"success": True}


@frappe.whitelist()
def get_my_sessions():
	"""Get all sessions owned by or shared with current user"""
	user = frappe.session.user

	# Sessions owned by user
	owned_sessions = frappe.get_all(
		"Canvas Session",
		filters={"owner": user},
		fields=["name", "session_id", "title", "base_doctype", "created_at", "last_activity", "is_public"],
		order_by="last_activity desc"
	)

	# Sessions shared with user
	shared_session_names = frappe.get_all(
		"Canvas Session Collaborator",
		filters={"user": user},
		fields=["parent"],
		pluck="parent"
	)

	shared_sessions = []
	if shared_session_names:
		shared_sessions = frappe.get_all(
			"Canvas Session",
			filters={"name": ["in", shared_session_names]},
			fields=["name", "session_id", "title", "base_doctype", "created_at", "last_activity", "is_public", "owner"],
			order_by="last_activity desc"
		)

	# Public sessions (exclude owned and already shared)
	public_sessions = frappe.get_all(
		"Canvas Session",
		filters={
			"is_public": 1,
			"owner": ["!=", user],
			"name": ["not in", shared_session_names] if shared_session_names else ["is", "not null"]
		},
		fields=["name", "session_id", "title", "base_doctype", "created_at", "last_activity", "owner"],
		order_by="last_activity desc",
		limit=20
	)

	return {
		"owned": owned_sessions,
		"shared": shared_sessions,
		"public": public_sessions
	}


@frappe.whitelist()
def get_active_sessions(doctype):
	"""Get all active sessions for a specific doctype that user can access"""
	user = frappe.session.user

	# Sessions owned by user for this doctype
	owned_sessions = frappe.get_all(
		"Canvas Session",
		filters={
			"owner": user,
			"base_doctype": doctype
		},
		fields=["name", "session_id", "title", "base_doctype", "owner", "creation", "last_activity", "is_public"],
		order_by="last_activity desc",
		limit=20
	)

	# Sessions shared with user for this doctype
	shared_session_names = frappe.get_all(
		"Canvas Session Collaborator",
		filters={"user": user},
		fields=["parent"],
		pluck="parent"
	)

	shared_sessions = []
	if shared_session_names:
		shared_sessions = frappe.get_all(
			"Canvas Session",
			filters={
				"name": ["in", shared_session_names],
				"base_doctype": doctype
			},
			fields=["name", "session_id", "title", "base_doctype", "owner", "creation", "last_activity", "is_public"],
			order_by="last_activity desc"
		)

	# Public sessions for this doctype
	public_filters = {
		"is_public": 1,
		"base_doctype": doctype,
		"owner": ["!=", user]
	}

	# Exclude sessions already in owned or shared lists
	if shared_session_names:
		public_filters["name"] = ["not in", shared_session_names]

	public_sessions = frappe.get_all(
		"Canvas Session",
		filters=public_filters,
		fields=["name", "session_id", "title", "base_doctype", "owner", "creation", "last_activity"],
		order_by="last_activity desc",
		limit=20
	)

	# Combine all sessions
	all_sessions = owned_sessions + shared_sessions + public_sessions

	return all_sessions


@frappe.whitelist()
def add_chat_message(session_id, message):
	"""Add a chat message to the session"""
	doc = frappe.get_doc("Canvas Session", session_id)

	# Check permission
	if not doc.has_permission("write"):
		frappe.throw("You do not have permission to send messages in this session")

	# Load existing messages
	chat_messages = json.loads(doc.chat_messages) if doc.chat_messages else []

	# Create new message
	new_message = {
		"user": frappe.session.user,
		"full_name": frappe.utils.get_fullname(frappe.session.user),
		"message": message,
		"timestamp": frappe.utils.now()
	}

	# Add to messages
	chat_messages.append(new_message)

	# Save back to doc
	doc.chat_messages = json.dumps(chat_messages)
	doc.flags.skip_last_activity_update = False  # Update last activity
	doc.save()

	# First commit the database changes
	frappe.db.commit()

	# Then broadcast to all users in this session using Frappe's doc room format
	frappe.publish_realtime(
		event='canvas_chat_message',
		message=new_message,
		room=f'doc:Canvas Session/{session_id}'
	)

	return new_message


@frappe.whitelist()
def join_canvas_session(session_id):
	"""Join a canvas session and get online users"""
	try:
		doc = frappe.get_doc("Canvas Session", session_id)
	except frappe.DoesNotExistError:
		frappe.throw(f"Canvas Session {session_id} not found")

	user = frappe.session.user

	# Allow joining if:
	# 1. User is owner, OR
	# 2. User is already a collaborator, OR
	# 3. Session is public, OR
	# 4. User has the session_id (we'll auto-add them as collaborator)
	# Basically, if they have the session_id, they can join
	# We'll add permission checks for actual canvas operations later

	# Get or create online users cache key
	cache_key = f"canvas_session_online_users_{session_id}"
	online_users = frappe.cache().get_value(cache_key) or {}

	# IMPORTANT: Remove any existing entry for this user first
	# This handles cases where page refresh/close didn't trigger leave event
	# (Idempotent join - prevents duplicate entries)
	if user in online_users:
		print(f"⚠️  User {user} already in online list - cleaning up stale entry")
		del online_users[user]

	# Add current user to online users with fresh timestamp
	online_users[user] = {
		"user": user,
		"full_name": frappe.utils.get_fullname(user),
		"joined_at": frappe.utils.now(),
		"last_seen": frappe.utils.now()
	}

	# Clean up stale users (inactive for more than 5 minutes)
	# This handles zombie connections from crashes/network issues
	current_time = frappe.utils.now_datetime()
	stale_users = []
	for u, data in list(online_users.items()):
		last_seen = frappe.utils.get_datetime(data.get("last_seen", data["joined_at"]))
		minutes_inactive = (current_time - last_seen).total_seconds() / 60
		if minutes_inactive > 5:
			stale_users.append(u)
			print(f"🧹 Removing stale user {u} (inactive for {minutes_inactive:.1f} minutes)")

	for u in stale_users:
		del online_users[u]

	# Cache for 1 hour (online users expire after inactivity)
	frappe.cache().set_value(cache_key, online_users, expires_in_sec=3600)

	# Auto-add user as collaborator if not owner and not already a collaborator
	if doc.owner != user:
		existing_collaborator = False
		for collab in doc.collaborators:
			if collab.user == user:
				existing_collaborator = True
				break

		if not existing_collaborator:
			# Add as Editor by default
			doc.append('collaborators', {
				'user': user,
				'role': 'Editor',
				'joined_at': frappe.utils.now()
			})

	# Update last activity
	doc.last_activity = frappe.utils.now()
	doc.flags.skip_permission_check = True
	doc.save()

	# Broadcast join event to all users in this session
	# Use Frappe's standard doc room format: "doc:DocType/docname"
	room_name = f'doc:Canvas Session/{session_id}'
	event_message = {
		"user": user,
		"full_name": frappe.utils.get_fullname(user),
		"session_id": session_id
	}

	# First commit the database changes
	frappe.db.commit()

	# Then publish the event to the canvas session room
	print(f"\n{'='*60}")
	print(f"🔴 PUBLISHING user_joined EVENT TO ROOM")
	print(f"User: {user}")
	print(f"Room: {room_name}")
	print(f"Message: {event_message}")
	print(f"{'='*60}\n")

	frappe.publish_realtime(
		event='user_joined',
		message=event_message,
		room=room_name
	)

	# Return online users list
	return {
		"online_users": list(online_users.values()),
		"session_id": session_id
	}


@frappe.whitelist()
def leave_canvas_session(session_id):
	"""Leave a canvas session"""
	user = frappe.session.user

	# Get online users cache
	cache_key = f"canvas_session_online_users_{session_id}"
	online_users = frappe.cache().get_value(cache_key) or {}

	# Remove current user
	if user in online_users:
		del online_users[user]

	# Update cache
	frappe.cache().set_value(cache_key, online_users, expires_in_sec=3600)

	# Broadcast leave event using Frappe's doc room format
	frappe.publish_realtime(
		event='user_left',
		message={
			"user": user,
			"full_name": frappe.utils.get_fullname(user),
			"session_id": session_id
		},
		room=f'doc:Canvas Session/{session_id}'
	)

	return {"status": "left", "session_id": session_id}
