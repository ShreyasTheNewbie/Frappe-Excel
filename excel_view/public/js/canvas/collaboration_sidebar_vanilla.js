frappe.provide('frappe.canvas');

frappe.canvas.CollaborationSidebarVanilla = class CollaborationSidebarVanilla {
	constructor({ parent, canvas }) {
		this.$parent = $(parent);
		this.canvas = canvas;
		this.session_data = null;
		this.online_users = [];
		this.chat_messages = [];

		this.make();
		this.setup_realtime();
	}

	make() {
		// Create main sidebar container
		this.$sidebar = $(`
			<div class="canvas-collab-sidebar-vanilla" style="
				position: fixed;
				top: var(--navbar-height, 60px);
				right: 0;
				width: 400px;
				height: calc(100vh - var(--navbar-height, 60px));
				background: #ffffff;
				border-left: 1px solid #e2e8f0;
				display: none;
				flex-direction: column;
				z-index: 1055;
				box-shadow: -4px 0 24px rgba(0, 0, 0, 0.08);
			">
				${this.get_header_html()}
				<div class="sidebar-content" style="flex: 1; overflow-y: auto; padding: 0;">
					<div class="session-info-container"></div>
					<div class="online-users-container"></div>
					<div class="chat-container"></div>
				</div>
			</div>
		`);

		this.$parent.append(this.$sidebar);

		// Cache containers
		this.$session_info = this.$sidebar.find('.session-info-container');
		this.$online_users = this.$sidebar.find('.online-users-container');
		this.$chat = this.$sidebar.find('.chat-container');

		this.setup_events();
	}

	get_header_html() {
		return `
			<div class="sidebar-header" style="
				padding: 20px 24px;
				border-bottom: 1px solid #e2e8f0;
				display: flex;
				justify-content: space-between;
				align-items: center;
				background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
				color: white;
				flex-shrink: 0;
			">
				<div class="header-content" style="display: flex; align-items: center; gap: 12px;">
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
						<circle cx="9" cy="7" r="4"></circle>
						<path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
						<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
					</svg>
					<h3 style="margin: 0; font-size: 18px; font-weight: 700;">Collaboration</h3>
				</div>
				<button class="close-sidebar-btn" style="
					padding: 8px;
					background: rgba(255, 255, 255, 0.15);
					border: none;
					color: white;
					border-radius: 8px;
					cursor: pointer;
					transition: all 0.2s ease;
				" title="Close sidebar">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>
		`;
	}

	setup_events() {
		// Close button
		this.$sidebar.find('.close-sidebar-btn').on('click', () => {
			this.hide();
		});

		// Hover effects
		this.$sidebar.find('.close-sidebar-btn').hover(
			function() { $(this).css('background', 'rgba(255, 255, 255, 0.25)'); },
			function() { $(this).css('background', 'rgba(255, 255, 255, 0.15)'); }
		);
	}

	setup_realtime() {
		// Listen to realtime events with error handling
		frappe.realtime.on('user_joined', (data) => {
			try {
				if (!data || !data.user) {
					console.error('❌ Invalid user_joined data:', data);
					return;
				}
				// Add user to online users list and update UI
				this.add_online_user(data);
			} catch (error) {
				console.error('❌ Error handling user_joined:', error);
				this.show_connection_error('Failed to update online users');
			}
		});

		frappe.realtime.on('user_left', (data) => {
			try {
				if (!data || !data.user) {
					console.error('❌ Invalid user_left data:', data);
					return;
				}
				this.remove_online_user(data);
			} catch (error) {
				console.error('❌ Error handling user_left:', error);
			}
		});

		frappe.realtime.on('canvas_chat_message', (data) => {
			try {
				if (!data || !data.message) {
					console.error('❌ Invalid chat message data:', data);
					return;
				}
				this.add_chat_message(data);
			} catch (error) {
				console.error('❌ Error handling chat message:', error);
				this.show_connection_error('Failed to receive chat message');
			}
		});

		// Socket connection status monitoring with auto-reconnection
		if (frappe.realtime?.socket) {
			frappe.realtime.socket.on('connect', () => {
				this.update_connection_status(true);
				this._reconnect_attempts = 0;

				// Rejoin session room if we were in a session
				if (this.canvas.active_session_id) {
					frappe.realtime.socket.emit('doc_subscribe', 'Canvas Session', this.canvas.active_session_id);

					frappe.show_alert({
						message: __('Connection restored'),
						indicator: 'green'
					});
				}
			});

			frappe.realtime.socket.on('disconnect', (reason) => {
				this.update_connection_status(false);
				this._handle_disconnect(reason);
			});

			frappe.realtime.socket.on('connect_error', (error) => {
				console.error('❌ Socket connection error:', error);
				this._reconnect_attempts = (this._reconnect_attempts || 0) + 1;

				if (this._reconnect_attempts <= 5) {
					this.show_connection_error(`Connection lost. Retry ${this._reconnect_attempts}/5...`);
				} else {
					this.show_connection_error('Unable to connect. Please refresh the page.');
				}
			});
		}
	}

	_handle_disconnect(reason) {
		// 'io server disconnect' means server forced disconnect
		if (reason === 'io server disconnect') {
			// Manual reconnection needed
			frappe.show_alert({
				message: __('Disconnected from server. Please refresh the page.'),
				indicator: 'red'
			});
		} else {
			// Other reasons will auto-reconnect
			// Show transient message
			if (!this._disconnect_notified) {
				frappe.show_alert({
					message: __('Connection lost. Reconnecting...'),
					indicator: 'orange'
				});
				this._disconnect_notified = true;

				// Clear flag after 10 seconds
				setTimeout(() => {
					this._disconnect_notified = false;
				}, 10000);
			}
		}
	}

	refresh(session_data, online_users) {
		this.session_data = session_data;
		this.online_users = online_users || [];
		this.chat_messages = session_data?.chat_messages || [];

		this.render_session_info();
		this.render_online_users();
		this.render_chat();

		this.show();
	}

	render_session_info() {
		if (!this.session_data) return;

		const html = `
			<div class="session-info-section" style="padding: 20px 24px; border-bottom: 1px solid #e2e8f0;">
				<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
					<div style="flex: 1;">
						<h4 style="margin: 0 0 4px 0; font-size: 16px; font-weight: 600; color: #1a202c;">
							${this.session_data.title}
						</h4>
						<p style="margin: 0; font-size: 13px; color: #718096;">
							${this.session_data.base_doctype} Canvas
						</p>
					</div>
					<span class="session-id-badge" style="
						background: #e0e7ff;
						color: #5145cd;
						padding: 4px 10px;
						border-radius: 12px;
						font-size: 11px;
						font-weight: 600;
						cursor: pointer;
						display: flex;
						align-items: center;
						gap: 6px;
					" title="Click to copy ID">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
							<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
						</svg>
						${this.session_data.name.slice(-6)}
					</span>
				</div>

				<div style="display: flex; align-items: center; gap: 12px;">
					${frappe.avatar(this.session_data.owner, 'avatar-medium')}
					<div style="flex: 1;">
						<div style="font-size: 14px; font-weight: 500; color: #2d3748; margin-bottom: 2px;">
							${frappe.user_info(this.session_data.owner).fullname}
						</div>
						<div style="font-size: 12px; color: #718096; display: flex; align-items: center; gap: 4px;">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z"></path>
							</svg>
							Session Owner
						</div>
					</div>
					<div style="font-size: 12px; color: #a0aec0;">
						${frappe.datetime.comment_when(this.session_data.creation)}
					</div>
				</div>
			</div>
		`;

		this.$session_info.html(html);

		// Copy session ID on click
		this.$session_info.find('.session-id-badge').on('click', () => {
			frappe.utils.copy_to_clipboard(this.session_data.name);
			frappe.show_alert({ message: __('Session ID copied!'), indicator: 'green' });
		});
	}

	render_online_users() {
		const html = `
			<div class="online-users-section" style="padding: 20px 24px; border-bottom: 1px solid #e2e8f0;">
				<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
					<div style="display: flex; align-items: center; gap: 8px;">
						<span style="
							width: 8px;
							height: 8px;
							background: #10b981;
							border-radius: 50%;
							display: inline-block;
							animation: pulse 2s infinite;
						"></span>
						<span style="font-size: 14px; font-weight: 600; color: #1a202c;">Online Now</span>
					</div>
					<span style="
						background: #10b981;
						color: white;
						padding: 2px 10px;
						border-radius: 12px;
						font-size: 12px;
						font-weight: 600;
					">${this.online_users.length}</span>
				</div>

				<div class="users-list" style="display: flex; flex-direction: column; gap: 12px;">
					${this.online_users.length === 0 ? this.get_empty_users_html() : this.get_users_list_html()}
				</div>

				${this.is_owner() ? `
					<button class="invite-btn" style="
						width: 100%;
						margin-top: 16px;
						padding: 12px 20px;
						background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
						color: white;
						border: none;
						border-radius: 12px;
						font-size: 14px;
						font-weight: 600;
						cursor: pointer;
						display: flex;
						align-items: center;
						justify-content: center;
						gap: 8px;
						transition: all 0.2s ease;
					">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
							<circle cx="8.5" cy="7" r="4"></circle>
							<line x1="20" y1="8" x2="20" y2="14"></line>
							<line x1="23" y1="11" x2="17" y2="11"></line>
						</svg>
						Invite Team Members
					</button>
				` : ''}
			</div>
		`;

		this.$online_users.html(html);

		// Invite button event
		if (this.is_owner()) {
			this.$online_users.find('.invite-btn').on('click', () => {
				this.show_invite_dialog();
			});

			// Hover effect
			this.$online_users.find('.invite-btn').hover(
				function() { $(this).css('transform', 'translateY(-2px)'); $(this).css('box-shadow', '0 8px 16px rgba(102, 126, 234, 0.4)'); },
				function() { $(this).css('transform', 'translateY(0)'); $(this).css('box-shadow', 'none'); }
			);
		}
	}

	get_users_list_html() {
		return this.online_users.map(user => `
			<div class="user-item" style="
				display: flex;
				align-items: center;
				gap: 12px;
				padding: 10px 12px;
				background: #f7fafc;
				border-radius: 10px;
			">
				${frappe.avatar(user.user, 'avatar-small')}
				<div style="flex: 1;">
					<div style="font-size: 14px; font-weight: 500; color: #2d3748; margin-bottom: 2px;">
						${frappe.user_info(user.user).fullname}
					</div>
					<div style="
						font-size: 11px;
						color: #10b981;
						display: flex;
						align-items: center;
						gap: 4px;
					">
						<span style="
							width: 6px;
							height: 6px;
							background: #10b981;
							border-radius: 50%;
							display: inline-block;
						"></span>
						Active
					</div>
				</div>
			</div>
		`).join('');
	}

	get_empty_users_html() {
		return `
			<div style="text-align: center; padding: 32px 16px; color: #a0aec0;">
				<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 12px;">
					<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
					<circle cx="9" cy="7" r="4"></circle>
					<path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
					<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
				</svg>
				<p style="margin: 0; font-size: 14px;">No other users online</p>
			</div>
		`;
	}

	render_chat() {
		const html = `
			<div class="chat-section" style="
				display: flex;
				flex-direction: column;
				flex: 1;
				min-height: 0;
				border-bottom: 1px solid #e2e8f0;
			">
				<div class="chat-header" style="
					padding: 16px 24px;
					border-bottom: 1px solid #e2e8f0;
					display: flex;
					justify-content: space-between;
					align-items: center;
				">
					<div style="display: flex; align-items: center; gap: 8px;">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
						</svg>
						<span style="font-size: 14px; font-weight: 600; color: #1a202c;">Team Chat</span>
					</div>
					${this.chat_messages.length > 0 ? `
						<span style="
							background: #e0e7ff;
							color: #5145cd;
							padding: 2px 8px;
							border-radius: 10px;
							font-size: 11px;
							font-weight: 600;
						">${this.chat_messages.length}</span>
					` : ''}
				</div>

				<div class="chat-messages" style="
					flex: 1;
					overflow-y: auto;
					padding: 16px;
					display: flex;
					flex-direction: column;
					gap: 12px;
				">
					${this.chat_messages.length === 0 ? this.get_empty_chat_html() : this.get_chat_messages_html()}
				</div>

				<div class="chat-input-wrapper" style="
					padding: 16px;
					border-top: 1px solid #e2e8f0;
					display: flex;
					gap: 8px;
				">
					<input type="text" class="chat-input" placeholder="Type a message..." style="
						flex: 1;
						padding: 10px 14px;
						border: 1px solid #e2e8f0;
						border-radius: 10px;
						font-size: 14px;
						outline: none;
						transition: border-color 0.2s;
					">
					<button class="send-btn" style="
						padding: 10px 16px;
						background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
						color: white;
						border: none;
						border-radius: 10px;
						cursor: pointer;
						display: flex;
						align-items: center;
						justify-content: center;
						transition: all 0.2s ease;
					">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<line x1="22" y1="2" x2="11" y2="13"></line>
							<polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
						</svg>
					</button>
				</div>
			</div>
		`;

		this.$chat.html(html);

		// Setup chat events
		const $input = this.$chat.find('.chat-input');
		const $send_btn = this.$chat.find('.send-btn');

		$input.on('focus', function() {
			$(this).css('border-color', '#667eea');
		}).on('blur', function() {
			$(this).css('border-color', '#e2e8f0');
		});

		$input.on('keypress', (e) => {
			if (e.key === 'Enter' && $input.val().trim()) {
				this.send_message($input.val().trim());
				$input.val('');
			}
		});

		$send_btn.on('click', () => {
			if ($input.val().trim()) {
				this.send_message($input.val().trim());
				$input.val('');
			}
		});

		// Hover effect
		$send_btn.hover(
			function() { $(this).css('transform', 'scale(1.05)'); },
			function() { $(this).css('transform', 'scale(1)'); }
		);

		// Auto-scroll to bottom
		this.scroll_chat_to_bottom();
	}

	get_chat_messages_html() {
		return this.chat_messages.map(msg => {
			const is_me = msg.user === frappe.session.user;
			return `
				<div class="chat-message ${is_me ? 'from-me' : 'from-other'}" style="
					display: flex;
					gap: 10px;
					${is_me ? 'flex-direction: row-reverse;' : ''}
				">
					${frappe.avatar(msg.user, 'avatar-small')}
					<div style="flex: 1; max-width: 70%;">
						<div style="
							display: flex;
							gap: 8px;
							margin-bottom: 4px;
							${is_me ? 'justify-content: flex-end;' : ''}
						">
							<span style="font-size: 12px; font-weight: 600; color: #4a5568;">
								${frappe.user_info(msg.user).fullname}
							</span>
							<span style="font-size: 11px; color: #a0aec0;">
								${frappe.datetime.comment_when(msg.timestamp)}
							</span>
						</div>
						<div style="
							background: ${is_me ? '#e0e7ff' : '#f7fafc'};
							padding: 10px 14px;
							border-radius: 12px;
							font-size: 14px;
							color: #2d3748;
							${is_me ? 'border-bottom-right-radius: 4px;' : 'border-bottom-left-radius: 4px;'}
						">
							${frappe.utils.escape_html(msg.message)}
						</div>
					</div>
				</div>
			`;
		}).join('');
	}

	get_empty_chat_html() {
		return `
			<div style="
				text-align: center;
				padding: 48px 16px;
				color: #a0aec0;
				margin: auto;
			">
				<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 16px; opacity: 0.5;">
					<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
					<line x1="9" y1="10" x2="15" y2="10"></line>
					<line x1="9" y1="14" x2="13" y2="14"></line>
				</svg>
				<p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 500;">No messages yet</p>
				<span style="font-size: 13px;">Start the conversation!</span>
			</div>
		`;
	}

	send_message(message) {
		// Validation
		if (!this.canvas.active_session_id) {
			frappe.show_alert({ message: __('Please start or join a session first'), indicator: 'orange' });
			return;
		}

		if (!message || message.trim().length === 0) {
			return;
		}

		if (message.length > 1000) {
			frappe.show_alert({ message: __('Message too long (max 1000 characters)'), indicator: 'orange' });
			return;
		}

		// Show sending indicator
		const $input = this.$chat.find('.chat-input');
		const $sendBtn = this.$chat.find('.send-btn');
		$sendBtn.prop('disabled', true).css('opacity', '0.5');

		frappe.call({
			method: 'excel_view.excel_view.doctype.canvas_session.canvas_session.add_chat_message',
			args: {
				session_id: this.canvas.active_session_id,
				message: message.trim()
			},
			callback: () => {
				// Success - re-enable button
				$sendBtn.prop('disabled', false).css('opacity', '1');
			},
			error: (err) => {
				console.error('❌ Failed to send message:', err);
				$sendBtn.prop('disabled', false).css('opacity', '1');

				frappe.show_alert({
					message: __('Failed to send message. Please try again.'),
					indicator: 'red'
				});

				// Restore message in input for retry
				$input.val(message);
			}
		});
	}

	add_chat_message(msg_data) {
		this.chat_messages.push(msg_data);
		this.render_chat();
	}

	add_online_user(user_data) {
		if (!this.online_users.find(u => u.user === user_data.user)) {
			this.online_users.push(user_data);
			this.render_online_users();

			frappe.show_alert({
				message: __(`{0} joined the canvas`, [frappe.user_info(user_data.user).fullname]),
				indicator: 'green'
			}, 3);
		}
	}

	remove_online_user(user_data) {
		const username = user_data.user || user_data;
		this.online_users = this.online_users.filter(u => u.user !== username);
		this.render_online_users();

		frappe.show_alert({
			message: __(`{0} left the canvas`, [frappe.user_info(username).fullname]),
			indicator: 'orange'
		}, 3);
	}

	show_invite_dialog() {
		if (!this.canvas.active_session_id) {
			frappe.msgprint(__('Please start a session first'));
			return;
		}

		const dialog = new frappe.ui.Dialog({
			title: __('Invite Team Members'),
			fields: [
				{
					fieldtype: 'Data',
					fieldname: 'session_id',
					label: __('Session ID'),
					read_only: 1,
					default: this.canvas.active_session_id
				},
				{
					fieldtype: 'HTML',
					fieldname: 'instructions',
					options: `
						<div style="padding: 12px; background: #f7fafc; border-radius: 6px; margin-top: 12px;">
							<p style="margin: 0 0 8px 0; font-size: 13px; color: #4a5568; font-weight: 500;">
								How to join:
							</p>
							<ol style="margin: 0; padding-left: 20px; font-size: 12px; color: #718096;">
								<li>Go to <strong>${this.session_data.base_doctype}</strong> in Desk</li>
								<li>Switch to <strong>Excel View</strong></li>
								<li>Click <strong>Collaborate</strong> button</li>
								<li>Go to <strong>Join Existing</strong> tab</li>
								<li>Paste the Session ID and click <strong>Join</strong></li>
							</ol>
						</div>
					`
				}
			],
			primary_action_label: __('Copy Session ID'),
			primary_action: (values) => {
				frappe.utils.copy_to_clipboard(values.session_id);
				frappe.show_alert({
					message: __('Session ID copied to clipboard!'),
					indicator: 'green'
				});
				dialog.hide();
			}
		});

		dialog.show();
	}

	scroll_chat_to_bottom() {
		const $messages = this.$chat.find('.chat-messages');
		$messages.scrollTop($messages[0].scrollHeight);
	}

	is_owner() {
		return this.session_data && this.session_data.owner === frappe.session.user;
	}

	show() {
		this.$sidebar.css('display', 'flex').hide().fadeIn(200);
	}

	hide() {
		this.$sidebar.fadeOut(200);
	}

	destroy() {
		this.$sidebar.remove();
	}

	// Connection status and error handling
	update_connection_status(connected) {
		const $header = this.$sidebar.find('.sidebar-header');
		if (!this.$connection_indicator) {
			this.$connection_indicator = $(`
				<div class="connection-indicator" style="
					width: 8px;
					height: 8px;
					border-radius: 50%;
					margin-left: 8px;
					transition: all 0.3s ease;
				"></div>
			`).appendTo($header.find('.header-content'));
		}

		if (connected) {
			this.$connection_indicator.css({
				'background': '#10b981',
				'box-shadow': '0 0 0 3px rgba(16, 185, 129, 0.2)'
			});
		} else {
			this.$connection_indicator.css({
				'background': '#ef4444',
				'box-shadow': '0 0 0 3px rgba(239, 68, 68, 0.2)'
			});
			// Show reconnecting message
			frappe.show_alert({
				message: __('Connection lost. Reconnecting...'),
				indicator: 'orange'
			});
		}
	}

	show_connection_error(message) {
		// Rate limit error messages (max 1 per 5 seconds)
		const now = Date.now();
		if (this._last_error_time && (now - this._last_error_time) < 5000) {
			return;
		}
		this._last_error_time = now;

		frappe.show_alert({
			message: __(message),
			indicator: 'red'
		});
	}
};
