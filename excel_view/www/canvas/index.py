import frappe

def get_context(context):
	"""Handle /app/canvas-session/{session_id} route"""
	# Get session_id from URL path
	path_parts = frappe.request.path.strip('/').split('/')
	session_id = path_parts[-1] if len(path_parts) > 0 else None

	if not session_id or session_id == 'canvas-session':
		frappe.throw("Session ID required")

	# Validate session exists and user has access
	try:
		doc = frappe.get_doc("Canvas Session", session_id)

		# Check permission
		if not doc.has_permission("read"):
			frappe.throw("You do not have permission to access this session")

		context.session_id = doc.session_id
		context.session_name = doc.name
		context.session_title = doc.title
		context.base_doctype = doc.base_doctype
		context.no_cache = 1

	except frappe.DoesNotExistError:
		frappe.throw(f"Canvas Session {session_id} not found")

	return context
