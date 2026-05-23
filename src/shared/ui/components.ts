import { setIcon } from "obsidian";

export function createIconButton(parent: HTMLElement, icon: string, label: string, className: string): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: `clickable-icon ${className}`,
    attr: {
      type: "button",
      "aria-label": label,
    },
  });
  setIcon(button, icon);
  return button;
}

export function createToolbarButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
  return createIconButton(parent, icon, label, "nav-action-button codex-panel-ui__toolbar-control codex-panel-ui__icon-button");
}

export function createRememberedDetails(
  parent: HTMLElement,
  openDetails: Set<string>,
  key: string,
  cls: string,
  summary: string,
  defaultOpen = false,
  onToggle?: () => void,
): HTMLDetailsElement {
  const details = parent.createEl("details", { cls });
  details.open = openDetails.has(key) || defaultOpen;
  details.createEl("summary", { text: summary });
  details.ontoggle = () => {
    if (details.open) {
      openDetails.add(key);
    } else {
      openDetails.delete(key);
    }
    onToggle?.();
  };
  return details;
}

export function createMetaPair(list: HTMLElement, key: string, value: string): void {
  list.createEl("dt", { text: key });
  list.createEl("dd", { text: value });
}

export function createDefinitionRow(list: HTMLElement, className: string, key: string, value: string): void {
  const row = list.createDiv({ cls: className });
  row.createEl("dt", { text: key });
  row.createEl("dd", { text: value });
}

export function setButtonIcon(button: HTMLButtonElement, icon: string): void {
  button.empty();
  setIcon(button, icon);
}
