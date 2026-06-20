import type { ComponentChild as UiNode } from "preact";

import type { HookItem } from "../domain/catalog/metadata";
import { ObsidianButton } from "../shared/ui/components";
import type { HookSectionState } from "./section-state";
import { SettingRow, SettingsGroup, SettingsHeading, SettingsItems, SettingsStatusRow } from "./setting-components";

export function HookSection({ state }: { state: HookSectionState }): UiNode {
  return (
    <SettingsGroup className="codex-panel-settings__dynamic-section codex-panel-settings__hook-section">
      <SettingsHeading dynamic name="Hook status" desc="Trust, enable, or disable discovered Codex hooks." />
      {state.contentAvailable ? (
        <Hooks state={state} />
      ) : !state.loading && state.status ? (
        <p className="setting-item-description codex-panel-settings__dynamic-section-status">{state.status}</p>
      ) : null}
    </SettingsGroup>
  );
}

function Hooks({ state }: { state: HookSectionState }): UiNode {
  return (
    <>
      <SettingsItems className="codex-panel-settings__dynamic-list codex-panel-settings__hook-list">
        {state.hooks.length === 0 ? (
          <SettingsStatusRow>No hooks found for this vault root.</SettingsStatusRow>
        ) : (
          state.hooks.map((hook) => <HookRow key={hook.key} hook={hook} state={state} />)
        )}
      </SettingsItems>
      {state.warnings.map((warning) => (
        <p key={`warning:${warning}`} className="setting-item-description codex-panel-settings__hook-warning">
          {warning}
        </p>
      ))}
      {state.errors.map((error) => (
        <p key={`error:${error}`} className="setting-item-description codex-panel-settings__hook-error">
          {error}
        </p>
      ))}
    </>
  );
}

function HookRow({ hook, state }: { hook: HookItem; state: HookSectionState }): UiNode {
  const canTrust = !hook.isManaged && (hook.trustStatus === "untrusted" || hook.trustStatus === "modified");
  const hookName = firstNonEmptyString(hook.statusMessage, hook.command, hook.matcher, hook.eventName);
  return (
    <SettingRow
      className="codex-panel-settings__dynamic-row codex-panel-settings__hook-row"
      name={hookName}
      desc={`${hook.eventName} · ${hook.matcher ?? "(no matcher)"} · ${hook.trustStatus} · ${hook.enabled ? "enabled" : "disabled"}`}
    >
      <ObsidianButton
        text="Trust"
        disabled={state.loading || !canTrust}
        onClick={() => {
          state.onTrust(hook);
        }}
      />
      <ObsidianButton
        text={hook.enabled ? "Disable" : "Enable"}
        disabled={state.loading || hook.isManaged}
        onClick={() => {
          state.onToggleEnabled(hook, !hook.enabled);
        }}
      />
    </SettingRow>
  );
}

function firstNonEmptyString(...values: (string | null | undefined)[]): string {
  return (
    values.find((value): value is string => typeof value === "string" && value.length > 0) ??
    values.find((value): value is string => typeof value === "string") ??
    ""
  );
}
