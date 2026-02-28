frappe.provide('frappe.canvas');

frappe.canvas.CollaborationDialogVanilla = class CollaborationDialogVanilla {
	constructor({ canvas }) {
		this.canvas = canvas;
		this.active_tab = 'start';
		this.session_title = '';
		this.session_list = [];
	}

	show() {
		// Clean up any existing dialog first
		if (this.dialog) {
			this.hide();
		}

		this.session_title = this.get_default_title();
		this.make_dialog();
		this.load_sessions();
		this.dialog.show();
	}

	get_default_title() {
		const doctype = this.canvas.board?.doctype || this.canvas.doctype;
		const now = frappe.datetime.now_datetime().replace(/[-:]/g, '-').replace(' ', ' ');
		return `${doctype} Canvas - ${now.slice(0, 19)}`;
	}

	make_dialog() {
		this.dialog = new frappe.ui.Dialog({
			title: __('Collaboration'),
			size: 'large',
			minimizable: false,
			fields: [
				{
					fieldtype: 'HTML',
					fieldname: 'collaboration_content'
				}
			],
			onhide: () => {
				// Force cleanup when dialog is closed (by X button or outside click)
				setTimeout(() => {
					$('.modal-backdrop').remove();
					$('body').removeClass('modal-open').css('overflow', '');
					if (this.dialog?.$wrapper) {
						this.dialog.$wrapper.remove();
					}
					this.dialog = null;
				}, 100);
			}
		});

		// Add modern styling
		this.dialog.$wrapper.addClass('collaboration-dialog-modern');

		// Render content
		this.render_content();
	}

	render_content() {
		const html = `
			<div class="collaboration-dialog-container" style="min-height: 400px;">
				<!-- Tabs -->
				<div class="collab-tabs" style="
					display: flex;
					gap: 8px;
					padding: 0 0 24px 0;
					border-bottom: 2px solid #e2e8f0;
				">
					<button class="collab-tab ${this.active_tab === 'start' ? 'active' : ''}" data-tab="start" style="
						flex: 1;
						padding: 14px 24px;
						background: ${this.active_tab === 'start' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'transparent'};
						color: ${this.active_tab === 'start' ? 'white' : '#64748b'};
						border: none;
						font-size: 15px;
						font-weight: 600;
						cursor: pointer;
						transition: all 0.2s ease;
					">
						<div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<circle cx="12" cy="12" r="10"></circle>
								<line x1="12" y1="8" x2="12" y2="16"></line>
								<line x1="8" y1="12" x2="16" y2="12"></line>
							</svg>
							<span>Start New Session</span>
						</div>
					</button>
					<button class="collab-tab ${this.active_tab === 'join' ? 'active' : ''}" data-tab="join" style="
						flex: 1;
						padding: 14px 24px;
						background: ${this.active_tab === 'join' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'transparent'};
						color: ${this.active_tab === 'join' ? 'white' : '#64748b'};
						border: none;
						font-size: 15px;
						font-weight: 600;
						cursor: pointer;
						transition: all 0.2s ease;
					">
						<div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
								<polyline points="10 17 15 12 10 7"></polyline>
								<line x1="15" y1="12" x2="3" y2="12"></line>
							</svg>
							<span>Join Existing</span>
						</div>
					</button>
				</div>

				<!-- Tab Content -->
				<div class="tab-content">
					<div class="start-tab-content" style="display: ${this.active_tab === 'start' ? 'block' : 'none'};">
						${this.get_start_tab_html()}
					</div>
					<div class="join-tab-content" style="display: ${this.active_tab === 'join' ? 'block' : 'none'};">
						${this.get_join_tab_html()}
					</div>
				</div>
			</div>
		`;

		this.dialog.fields_dict.collaboration_content.$wrapper.html(html);
		this.setup_tab_events();
	}

	get_start_tab_html() {
		return `
			<div style="max-width: 600px; margin: 0 auto;">
				<div style="text-align: center; margin-bottom: 32px;">
					<div style="
						width: 80px;
						height: 80px;
						background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
						border-radius: 20px;
						display: flex;
						align-items: center;
						justify-content: center;
						margin: 0 auto 20px;
					">
						<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
							<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
							<circle cx="9" cy="7" r="4"></circle>
							<path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
							<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
						</svg>
					</div>
					<h3 style="margin: 0 0 12px 0; font-size: 24px; font-weight: 700; color: #1a202c;">
						Start a New Canvas Session
					</h3>
					<p style="margin: 0; font-size: 15px; color: #64748b; line-height: 1.6;">
						Create a collaborative workspace where your team can work together in real-time
					</p>
				</div>

				<div style="background: #f8fafc; padding: 28px; border-radius: 16px; margin-bottom: 28px;">
					<label style="
						display: block;
						font-size: 14px;
						font-weight: 600;
						color: #475569;
						margin-bottom: 10px;
					">Session Title</label>
					<input type="text" class="session-title-input" value="${this.session_title}" style="
						width: 100%;
						padding: 14px 16px;
						border: 2px solid #e2e8f0;
						border-radius: 10px;
						font-size: 15px;
						outline: none;
						transition: border-color 0.2s;
					" placeholder="Enter session title...">
				</div>

				<button class="btn-start-session" style="
					width: 100%;
					padding: 16px;
					background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
					color: white;
					border: none;
					border-radius: 12px;
					font-size: 16px;
					font-weight: 600;
					cursor: pointer;
					transition: all 0.2s ease;
					display: flex;
					align-items: center;
					justify-content: center;
					gap: 10px;
				">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="10"></circle>
						<polyline points="12 6 12 12 16 14"></polyline>
					</svg>
					Start Session
				</button>
			</div>
		`;
	}

	get_join_tab_html() {
		return `
			<div style="max-width: 600px; margin: 0 auto;">
				<div style="text-align: center; margin-bottom: 32px;">
					<div style="
						width: 80px;
						height: 80px;
						background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
						border-radius: 20px;
						display: flex;
						align-items: center;
						justify-content: center;
						margin: 0 auto 20px;
					">
						<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
							<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
							<polyline points="10 17 15 12 10 7"></polyline>
							<line x1="15" y1="12" x2="3" y2="12"></line>
						</svg>
					</div>
					<h3 style="margin: 0 0 12px 0; font-size: 24px; font-weight: 700; color: #1a202c;">
						Join an Existing Session
					</h3>
					<p style="margin: 0; font-size: 15px; color: #64748b; line-height: 1.6;">
						Select a session to collaborate with your team and work on canvas together
					</p>
				</div>

				<!-- Manual Join Section -->
				<div style="background: #f8fafc; padding: 20px; border-radius: 12px; margin-bottom: 24px;">
					<div style="display: flex; align-items: center; gap: 12px;">
						<input
							type="text"
							class="manual-session-id-input"
							placeholder="Enter Session ID (e.g., e7bf4b56)"
							style="
								flex: 1;
								padding: 12px 16px;
								border: 2px solid #e2e8f0;
								border-radius: 8px;
								font-size: 14px;
								outline: none;
								transition: all 0.2s;
							"
						/>
						<button class="btn-manual-join" style="
							padding: 12px 24px;
							background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
							color: white;
							border: none;
							border-radius: 8px;
							font-weight: 600;
							cursor: pointer;
							font-size: 14px;
							white-space: nowrap;
							transition: all 0.2s;
						">Join Session</button>
					</div>
					<p style="margin: 8px 0 0 0; font-size: 12px; color: #718096;">
						Paste the Session ID shared by your team member
					</p>
				</div>

				<div class="sessions-list">
					${this.get_sessions_list_html()}
				</div>
			</div>
		`;
	}

	get_sessions_list_html() {
		if (!this.session_list || this.session_list.length === 0) {
			return `
				<div style="background: #f8fafc; padding: 28px; border-radius: 16px; margin-bottom: 28px;">
					<div style="text-align: center; padding: 24px 0;">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5" style="margin: 0 auto 16px; display: block; opacity: 0.5;">
							<circle cx="12" cy="12" r="10"></circle>
							<line x1="12" y1="8" x2="12" y2="12"></line>
							<line x1="12" y1="16" x2="12.01" y2="16"></line>
						</svg>
						<p style="margin: 0; font-size: 14px; color: #94a3b8;">
							No active sessions found
						</p>
					</div>
				</div>
			`;
		}

		return this.session_list.map(session => `
			<div class="session-card" data-session-id="${session.name}" style="
				background: white;
				border: 2px solid #e2e8f0;
				border-radius: 12px;
				padding: 20px;
				cursor: pointer;
				transition: all 0.2s ease;
			">
				<div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 14px;">
					<div style="flex: 1;">
						<h4 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 600; color: #1a202c;">
							${session.title}
						</h4>
						<p style="margin: 0; font-size: 13px; color: #64748b;">
							${session.base_doctype} Canvas
						</p>
					</div>
					<span style="
						background: #dcfce7;
						color: #16a34a;
						padding: 4px 12px;
						border-radius: 12px;
						font-size: 11px;
						font-weight: 600;
					">Active</span>
				</div>

				<div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
					${frappe.avatar(session.owner, 'avatar-small')}
					<div style="flex: 1;">
						<div style="font-size: 13px; font-weight: 500; color: #475569;">
							${frappe.user_info(session.owner).fullname}
						</div>
						<div style="font-size: 12px; color: #94a3b8;">
							${frappe.datetime.comment_when(session.creation)}
						</div>
					</div>
				</div>

				<button class="btn-join-session" data-session-id="${session.name}" style="
					width: 100%;
					padding: 10px;
					background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
					color: white;
					border: none;
					border-radius: 8px;
					font-size: 14px;
					font-weight: 600;
					cursor: pointer;
					transition: all 0.2s ease;
				">Join Session</button>
			</div>
		`).join('');
	}

	setup_tab_events() {
		const $container = this.dialog.fields_dict.collaboration_content.$wrapper;

		// Tab switching
		$container.find('.collab-tab').on('click', (e) => {
			const tab = $(e.currentTarget).data('tab');
			this.active_tab = tab;
			this.render_content();
		});

		// Start session
		$container.find('.btn-start-session').on('click', () => {
			const title = $container.find('.session-title-input').val().trim();
			if (!title) {
				frappe.show_alert({ message: __('Please enter a session title'), indicator: 'orange' });
				return;
			}
			this.start_session(title);
		});

		// Switch to start tab from empty state
		$container.find('.btn-switch-to-start').on('click', () => {
			this.active_tab = 'start';
			this.render_content();
		});

		// Join session from list
		$container.find('.btn-join-session').on('click', (e) => {
			let session_id = $(e.currentTarget).data('session-id');
			// Strip any query parameters that might have been appended
			session_id = session_id.split('?')[0].split('#')[0].trim();
			this.join_session(session_id);
		});

		// Manual join with session ID
		$container.find('.btn-manual-join').on('click', () => {
			let session_id = $container.find('.manual-session-id-input').val().trim();
			if (!session_id) {
				frappe.show_alert({ message: __('Please enter a Session ID'), indicator: 'orange' });
				return;
			}
			// Strip any query parameters that might have been appended
			session_id = session_id.split('?')[0].split('#')[0].trim();
			this.join_session(session_id);
		});

		// Join on Enter key in manual input
		$container.find('.manual-session-id-input').on('keypress', (e) => {
			if (e.key === 'Enter') {
				$container.find('.btn-manual-join').click();
			}
		});

		// Session card hover
		$container.find('.session-card').hover(
			function() {
				$(this).css('border-color', '#667eea');
				$(this).css('box-shadow', '0 8px 24px rgba(102, 126, 234, 0.15)');
			},
			function() {
				$(this).css('border-color', '#e2e8f0');
				$(this).css('box-shadow', 'none');
			}
		);

		// Input focus
		$container.find('.session-title-input').on('focus', function() {
			$(this).css('border-color', '#667eea');
		}).on('blur', function() {
			$(this).css('border-color', '#e2e8f0');
		});

		// Button hover
		$container.find('.btn-start-session, .btn-join-session, .btn-switch-to-start').hover(
			function() { $(this).css('transform', 'translateY(-2px)'); $(this).css('box-shadow', '0 8px 16px rgba(102, 126, 234, 0.4)'); },
			function() { $(this).css('transform', 'translateY(0)'); $(this).css('box-shadow', 'none'); }
		);

		// Tab button hover
		$container.find('.collab-tab').hover(
			function() {
				if (!$(this).hasClass('active')) {
					$(this).css('background', '#f1f5f9');
				}
			},
			function() {
				if (!$(this).hasClass('active')) {
					$(this).css('background', 'transparent');
				}
			}
		);
	}

	async load_sessions() {
		try {
			const doctype = this.canvas.board?.doctype || this.canvas.doctype;

			const res = await frappe.call({
				method: 'excel_view.excel_view.doctype.canvas_session.canvas_session.get_active_sessions',
				args: { doctype: doctype }
			});

			this.session_list = res.message || [];

			// Re-render join tab if it's active
			if (this.active_tab === 'join') {
				this.render_content();
			}
		} catch (err) {
			console.error('❌ Failed to load sessions:', err);
			this.session_list = [];
		}
	}

	async start_session(title) {
		try {
			const doctype = this.canvas.board?.doctype || this.canvas.doctype;
			const canvas_state = this.canvas._get_canvas_state();

			const res = await frappe.call({
				method: 'excel_view.excel_view.doctype.canvas_session.canvas_session.create_session',
				args: {
					title: title,
					base_doctype: doctype,
					canvas_state: canvas_state
				}
			});

			if (res.message) {

				// Hide dialog - onhide callback will handle cleanup
				this.dialog.hide();

				// Join the session
				if (this.canvas._join_session) {
					await this.canvas._join_session(res.message.session_id);
				}

				frappe.show_alert({
					message: __('Session started successfully!'),
					indicator: 'green'
				});
			}
		} catch (err) {
			console.error('Failed to start session:', err);
			frappe.show_alert({
				message: __('Failed to start session'),
				indicator: 'red'
			});
		}
	}

	async join_session(session_id) {
		try {
			// Hide dialog - onhide callback will handle cleanup
			this.dialog.hide();

			if (this.canvas._join_session) {
				await this.canvas._join_session(session_id);
			}

			frappe.show_alert({
				message: __('Joining session...'),
				indicator: 'blue'
			});
		} catch (err) {
			console.error('Failed to join session:', err);
			frappe.show_alert({
				message: __('Failed to join session'),
				indicator: 'red'
			});
		}
	}

	hide() {
		if (this.dialog) {
			// Just call hide - onhide callback will handle cleanup
			this.dialog.hide();
		}
	}
};
