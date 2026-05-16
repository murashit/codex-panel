import type { EffectiveConfigSection } from "../runtime/view";
import { createDefinitionRow } from "./components";

export function renderEffectiveConfig(parent: HTMLElement, sections: EffectiveConfigSection[]): void {
  const panel = parent.createDiv({ cls: "codex-panel__config" });
  panel.createDiv({ cls: "codex-panel__config-title", text: "Effective Codex config" });
  const list = panel.createEl("dl", { cls: "codex-panel__config-list" });
  for (const section of sections) {
    list.createDiv({ cls: "codex-panel__config-section", text: section.title });
    for (const row of section.rows) {
      createDefinitionRow(list, "codex-panel__config-row", row.key, row.value);
    }
  }
}
