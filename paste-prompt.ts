import { setIcon } from "obsidian";

export interface PasteChoice {
	icon: string;
	title: string;
	desc: string;
	run: () => void;
}

/**
 * Small card shown at the cursor after pasting a YouTube link.
 * Up/Down choose, Enter confirms, Esc or a click elsewhere keeps the plain link,
 * and any other typing closes it and reaches the editor untouched.
 */
export class PastePrompt {
	private el: HTMLElement;
	private items: HTMLElement[] = [];
	private selected = 0;
	private closed = false;

	constructor(
		private win: Window,
		at: { left: number; top: number; bottom: number },
		private choices: PasteChoice[],
		heading: string,
	) {
		const doc = win.document;
		this.el = doc.body.createDiv({ cls: "youtube-paste-prompt" });
		this.el.createDiv({ cls: "youtube-paste-prompt-heading", text: heading });

		choices.forEach((choice, i) => {
			const item = this.el.createDiv({ cls: "youtube-paste-prompt-item" });
			setIcon(item.createDiv({ cls: "youtube-paste-prompt-icon" }), choice.icon);
			const text = item.createDiv({ cls: "youtube-paste-prompt-text" });
			text.createDiv({ cls: "youtube-paste-prompt-title", text: choice.title });
			text.createDiv({ cls: "youtube-paste-prompt-desc", text: choice.desc });
			// mousedown keeps focus in the editor; click runs the choice.
			item.addEventListener("mousedown", (e) => e.preventDefault());
			item.addEventListener("mouseenter", () => this.select(i));
			item.addEventListener("click", () => this.choose(i));
			this.items.push(item);
		});

		this.select(0);
		this.place(at);

		win.addEventListener("keydown", this.onKey, true);
		win.addEventListener("mousedown", this.onOutside, true);
		win.addEventListener("resize", this.close);
	}

	private place(at: { left: number; top: number; bottom: number }) {
		const { innerWidth, innerHeight } = this.win;
		const rect = this.el.getBoundingClientRect();
		const left = Math.max(8, Math.min(at.left, innerWidth - rect.width - 8));
		const below = at.bottom + 6;
		const top = below + rect.height > innerHeight - 8 ? Math.max(8, at.top - rect.height - 6) : below;
		this.el.style.left = `${left}px`;
		this.el.style.top = `${top}px`;
	}

	private select(i: number) {
		this.selected = (i + this.items.length) % this.items.length;
		this.items.forEach((item, j) => item.toggleClass("is-selected", j === this.selected));
	}

	private choose(i: number) {
		const choice = this.choices[i];
		this.close();
		choice.run();
	}

	private onKey = (e: KeyboardEvent) => {
		if (e.isComposing) return;
		const handled = (fn: () => void) => {
			e.preventDefault();
			e.stopPropagation();
			fn();
		};
		if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) handled(() => this.select(this.selected + 1));
		else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) handled(() => this.select(this.selected - 1));
		else if (e.key === "Enter") handled(() => this.choose(this.selected));
		else if (e.key === "Escape") handled(this.close);
		else if (!["Shift", "Meta", "Control", "Alt", "CapsLock"].includes(e.key)) this.close();
	};

	private onOutside = (e: MouseEvent) => {
		if (!this.el.contains(e.target as Node)) this.close();
	};

	close = () => {
		if (this.closed) return;
		this.closed = true;
		this.el.remove();
		this.win.removeEventListener("keydown", this.onKey, true);
		this.win.removeEventListener("mousedown", this.onOutside, true);
		this.win.removeEventListener("resize", this.close);
	};
}
