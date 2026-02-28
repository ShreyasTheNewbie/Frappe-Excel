import './collaboration_dialog_vanilla.js';

export class CollaborationDialogWrapper {
	constructor({ canvas }) {
		this.canvas = canvas;
		this.dialog_instance = null;
	}

	show() {
		// Use vanilla JS version
		this.dialog_instance = new frappe.canvas.CollaborationDialogVanilla({
			canvas: this.canvas
		});

		this.dialog_instance.show();
	}

	hide() {
		if (this.dialog_instance) {
			this.dialog_instance.hide();
		}
	}
}

frappe.provide('frappe.canvas');
frappe.canvas.CollaborationDialog = CollaborationDialogWrapper;
