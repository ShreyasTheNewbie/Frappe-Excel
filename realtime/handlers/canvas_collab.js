// Canvas Collaboration Real-time Event Handler
// Handles Socket.IO events for collaborative canvas sessions

const activeSessions = new Map(); // session_id -> Set of socket.ids
const userSockets = new Map(); // socket.id -> {session_id, user, full_name, image}

function canvas_collab_handlers(realtime, socket) {
	// Join canvas session room
	socket.on("join_canvas", async (data) => {
		try {
			const { session_id } = data;

			if (!session_id) {
				socket.emit("error", { message: "session_id is required" });
				return;
			}

			// Get user info from socket (set by Frappe's auth middleware)
			// Frappe's auth sets: socket.user, socket.user_type, socket.sid
			const user = socket.user || socket.request?.user || "Guest";

			// Get full user info
			let full_name = user;
			let user_image = null;

			// Try to get from socket first
			if (socket.full_name) {
				full_name = socket.full_name;
			}
			if (socket.user_image) {
				user_image = socket.user_image;
			}

			const user_info = {
				user: user,
				full_name: full_name,
				image: user_image
			};


			// Join the room (use canvas_ prefix to avoid conflicts)
			const room_name = `canvas_${session_id}`;
			socket.join(room_name);

			// Track session and user
			if (!activeSessions.has(session_id)) {
				activeSessions.set(session_id, new Set());
			}
			activeSessions.get(session_id).add(socket.id);

			userSockets.set(socket.id, {
				session_id,
				...user_info
			});

			// Get online users for this session
			const online_users = [];
			const sessionSockets = activeSessions.get(session_id);
			for (const sid of sessionSockets) {
				const userInfo = userSockets.get(sid);
				if (userInfo) {
					online_users.push({
						user: userInfo.user,
						full_name: userInfo.full_name,
						image: userInfo.image
					});
				}
			}

			// Emit to the joining user
			socket.emit("canvas_joined", {
				session_id,
				online_users
			});

			// Broadcast to others in the room
			socket.to(room_name).emit("user_joined", {
				user: user_info.user,
				full_name: user_info.full_name,
				image: user_info.image
			});

		} catch (error) {
			console.error("[Canvas Collab] Error joining canvas:", error);
			socket.emit("error", { message: error.message });
		}
	});

	// Canvas state update
	socket.on("canvas_update", (data) => {
		try {
			const { session_id, delta, timestamp } = data;
			const userInfo = userSockets.get(socket.id);

			if (!userInfo || userInfo.session_id !== session_id) {
				socket.emit("error", { message: "Not in this session" });
				return;
			}

			const room_name = `canvas_${session_id}`;

			// Broadcast to all others in the room
			socket.to(room_name).emit("canvas_updated", {
				delta,
				user: userInfo.user,
				timestamp
			});
		} catch (error) {
			console.error("[Canvas Collab] Error updating canvas:", error);
		}
	});

	// Node position update (real-time, throttled on client side)
	// Phase 4: Lightweight position-only update for smooth dragging
	socket.on("canvas_node_moved", (data) => {
		try {
			const { session_id, node_id, position } = data;
			const userInfo = userSockets.get(socket.id);

			if (!userInfo || userInfo.session_id !== session_id) {
				return; // Silently ignore invalid session
			}

			const room_name = `canvas_${session_id}`;

			// Broadcast to others in the room (not sender)
			socket.to(room_name).emit("canvas_node_moved", {
				session_id,
				node_id,
				position,
				user: userInfo.user,
				full_name: userInfo.full_name
			});
		} catch (error) {
			console.error("[Canvas Collab] Error broadcasting node move:", error);
		}
	});

	// Live cursor movement (throttled on client side)
	socket.on("cursor_move", (data) => {
		try {
			const { session_id, x, y } = data;
			const userInfo = userSockets.get(socket.id);

			if (!userInfo || userInfo.session_id !== session_id) {
				return;
			}

			const room_name = `canvas_${session_id}`;

			// Broadcast cursor position
			socket.to(room_name).emit("cursor_moved", {
				user: userInfo.user,
				full_name: userInfo.full_name,
				image: userInfo.image,
				x,
				y
			});
		} catch (error) {
			console.error("[Canvas Collab] Error moving cursor:", error);
		}
	});

	// Chat message
	socket.on("chat_message", async (data) => {
		try {
			const { session_id, message } = data;
			const userInfo = userSockets.get(socket.id);

			if (!userInfo || userInfo.session_id !== session_id) {
				socket.emit("error", { message: "Not in this session" });
				return;
			}

			const room_name = `canvas_${session_id}`;

			const chat_msg = {
				id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				user: userInfo.user,
				full_name: userInfo.full_name,
				image: userInfo.image,
				message: message,
				timestamp: new Date().toISOString()
			};

			// Broadcast to everyone in the room (including sender)
			realtime.in(room_name).emit("chat_message_received", chat_msg);

			// Save to database (fire and forget - don't block)
			try {
				const frappe = realtime.frappe;
				if (frappe) {
					frappe.call({
						method: 'excel_view.excel_view.doctype.canvas_session.canvas_session.add_chat_message',
						args: {
							session_id: session_id,
							message: message
						}
					}).catch(err => {
						console.error("[Canvas Collab] Failed to save chat message to DB:", err);
					});
				}
			} catch (dbError) {
				// Don't fail the real-time message if DB save fails
				console.error("[Canvas Collab] DB save error:", dbError);
			}
		} catch (error) {
			console.error("[Canvas Collab] Error sending chat:", error);
		}
	});

	// Sticky note operations
	socket.on("sticky_note_add", (data) => {
		try {
			const { session_id, note } = data;
			const userInfo = userSockets.get(socket.id);

			if (!userInfo || userInfo.session_id !== session_id) {
				socket.emit("error", { message: "Not in this session" });
				return;
			}

			const room_name = `canvas_${session_id}`;

			const new_note = {
				id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				...note,
				user: userInfo.user,
				timestamp: new Date().toISOString()
			};

			// Broadcast to everyone
			realtime.in(room_name).emit("sticky_note_added", { note: new_note });
		} catch (error) {
			console.error("[Canvas Collab] Error adding sticky note:", error);
		}
	});

	socket.on("sticky_note_update", (data) => {
		try {
			const { session_id, note_id, updates } = data;
			const userInfo = userSockets.get(socket.id);

			if (!userInfo || userInfo.session_id !== session_id) {
				return;
			}

			const room_name = `canvas_${session_id}`;

			// Broadcast to others
			socket.to(room_name).emit("sticky_note_updated", {
				note_id,
				updates,
				user: userInfo.user,
				timestamp: new Date().toISOString()
			});
		} catch (error) {
			console.error("[Canvas Collab] Error updating sticky note:", error);
		}
	});

	socket.on("sticky_note_delete", (data) => {
		try {
			const { session_id, note_id } = data;
			const userInfo = userSockets.get(socket.id);

			if (!userInfo || userInfo.session_id !== session_id) {
				return;
			}

			const room_name = `canvas_${session_id}`;

			// Broadcast to everyone
			realtime.in(room_name).emit("sticky_note_deleted", { note_id });
		} catch (error) {
			console.error("[Canvas Collab] Error deleting sticky note:", error);
		}
	});

	// Track disconnections for cleanup
	socket.on("disconnect", () => {
		try {
			const userInfo = userSockets.get(socket.id);

			if (userInfo) {
				const { session_id, user } = userInfo;
				const room_name = `canvas_${session_id}`;

				// Remove from tracking
				if (activeSessions.has(session_id)) {
					activeSessions.get(session_id).delete(socket.id);

					// Clean up empty sessions
					if (activeSessions.get(session_id).size === 0) {
						activeSessions.delete(session_id);
					}
				}

				userSockets.delete(socket.id);

				// Notify others
				socket.to(room_name).emit("user_left", { user });

			}
		} catch (error) {
			console.error("[Canvas Collab] Error on disconnect:", error);
		}
	});
}

module.exports = canvas_collab_handlers;
