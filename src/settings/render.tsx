import { renderUiRoot, unmountUiRoot } from "../shared/ui/ui-root";
import { SettingsDynamicSections, type SettingsDynamicSectionsState } from "./dynamic-sections";

export function renderSettingsDynamicSections(container: HTMLElement, state: SettingsDynamicSectionsState): void {
  renderUiRoot(container, <SettingsDynamicSections state={state} />);
}

export function unmountSettingsDynamicSections(container: HTMLElement | null): void {
  unmountUiRoot(container);
}
