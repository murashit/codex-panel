import { type App, Modal, Setting } from "obsidian";

export function confirmForkDiscard(app: App): Promise<boolean> {
  return new Promise((resolve) => {
    new ForkDiscardModal(app, resolve).open();
  });
}

class ForkDiscardModal extends Modal {
  private discard = false;

  constructor(
    app: App,
    private readonly resolve: (discard: boolean) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.contentEl.createEl("h2", { text: "Discard changes to this fork?" });
    this.contentEl.createEl("p", { text: "Your unsent edits and attachments will be discarded. The source thread will not be changed." });
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText("Keep editing").onClick(() => {
          this.close();
        }),
      )
      .addButton((button) =>
        button
          .setButtonText("Discard and return")
          .setDestructive()
          .onClick(() => {
            this.discard = true;
            this.close();
          }),
      );
    this.contentEl.querySelector("button")?.focus();
  }

  override onClose(): void {
    this.resolve(this.discard);
    this.contentEl.empty();
  }
}
