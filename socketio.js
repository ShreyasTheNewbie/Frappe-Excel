/**
 * Excel View Socket.IO Entry Point
 * Extends Frappe's Socket.IO server with canvas collaboration handlers
 * All changes contained within excel_view app - no frappe core modifications
 */

// First, load Frappe's Socket.IO server (this starts the server)
const frappe_socketio = require('../frappe/socketio.js');

// Wait for frappe's realtime to be ready, then extend it
setTimeout(() => {
	try {
		// Access the global io instance that frappe creates
		const io = global.frappe_io;

		if (!io) {
			console.log("[Excel View] Frappe Socket.IO not ready yet");
			return;
		}

		// Load our canvas collaboration handlers
		const canvas_collab_handlers = require('./realtime/handlers/canvas_collab');

		// Extend the connection event with our handlers
		// Frappe's handlers are already attached, we add ours on top
		io.on('connection', (socket) => {
			// Add canvas collaboration handlers to this socket
			canvas_collab_handlers(io, socket);
		});

		console.log("[Excel View] ✓ Canvas collaboration handlers registered");

	} catch (error) {
		console.error("[Excel View] Failed to register canvas handlers:", error);
	}
}, 100);

// Export frappe's socketio module so bench can use it
module.exports = frappe_socketio;
