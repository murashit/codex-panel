import type { ComponentChild as UiNode } from "preact";

import type { HookItem } from "../../domain/catalog/metadata";
import { ObsidianButton } from "./controls.obsidian";
import { SettingRow, SettingsItems, SettingsStatusRow } from "./layout";
export interface CodexHooksViewModel {
  catalog: { hooks: readonly HookItem[]; warnings: readonly string[]; errors: readonly string[] } | null;
  loading: boolean;
  error: string | null;
  onTrust: (hook: HookItem) => void;
  onToggleEnabled: (hook: HookItem, enabled: boolean) => void;
}

export function CodexHooksContent({ state }: { state: CodexHooksViewModel }): UiNode {
  const catalog = state.catalog;
  return (
    <>
      {catalog ? <Hooks catalog={catalog} state={state} /> : null}
      {!state.loading && state.error ? (
        <p className="setting-item-description codex-panel-settings__dynamic-section-status">{state.error}</p>
      ) : null}
    </>
  );
}

function Hooks({ catalog, state }: { catalog: NonNullable<CodexHooksViewModel["catalog"]>; state: CodexHooksViewModel }): UiNode {
  return (
    <>
      <SettingsItems className="codex-panel-settings__dynamic-list codex-panel-settings__hook-list">
        {catalog.hooks.length === 0 ? (
          <SettingsStatusRow>No hooks found for this vault root.</SettingsStatusRow>
        ) : (
          catalog.hooks.map((hook) => <HookRow key={hook.key} hook={hook} state={state} />)
        )}
      </SettingsItems>
      {catalog.warnings.map((warning) => (
        <p key={`warning:${warning}`} className="setting-item-description codex-panel-settings__hook-warning">
          {warning}
        </p>
      ))}
      {catalog.errors.map((error) => (
        <p key={`error:${error}`} className="setting-item-description codex-panel-settings__hook-error">
          {error}
        </p>
      ))}
    </>
  );
}

function HookRow({ hook, state }: { hook: HookItem; state: CodexHooksViewModel }): UiNode {
  const canTrust = !hook.isManaged && (hook.trustStatus === "untrusted" || hook.trustStatus === "modified");
  const canToggle = !hook.isManaged && hook.trustStatus === "trusted";
  const hookName = firstNonEmptyString(hook.statusMessage, hook.handlerSummary, hook.matcher, hook.eventName);
  const executionStatus =
    hook.trustStatus === "trusted" || hook.trustStatus === "managed" ? (hook.enabled ? "enabled" : "disabled") : "inactive";
  return (
    <SettingRow
      className="codex-panel-settings__dynamic-row codex-panel-settings__hook-row"
      name={hookName}
      desc={`${hook.eventName} · ${hook.matcher ?? "(no matcher)"} · ${hook.trustStatus} · ${executionStatus}`}
    >
      {canTrust ? (
        <ObsidianButton
          text="Trust"
          disabled={state.loading}
          onClick={() => {
            state.onTrust(hook);
          }}
        />
      ) : null}
      {canToggle ? (
        <ObsidianButton
          text={hook.enabled ? "Disable" : "Enable"}
          disabled={state.loading}
          onClick={() => {
            state.onToggleEnabled(hook, !hook.enabled);
          }}
        />
      ) : null}
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
