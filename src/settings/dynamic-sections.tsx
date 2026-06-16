import type { ComponentChild as UiNode, TargetedMouseEvent, TargetedPointerEvent } from "preact";

import type { HookItem, ModelMetadata, ReasoningEffort } from "../domain/catalog/metadata";
import type { Thread } from "../domain/threads/model";
import { IconButton } from "../shared/ui/components";
import { shortThreadId } from "../utils";
import { archivedThreadDisplayTitle } from "./archived-thread-title";

const CODEX_DEFAULT_VALUE = "__codex-default__";

interface HelperSettingsState {
  threadNamingModel: string | null;
  threadNamingEffort: ReasoningEffort | null;
  rewriteSelectionModel: string | null;
  rewriteSelectionEffort: ReasoningEffort | null;
  models: readonly ModelMetadata[];
  modelLoadFailed: boolean;
  modelStatus: string;
  onThreadNamingModelChange: (value: string | null) => void;
  onThreadNamingEffortChange: (value: ReasoningEffort | null) => void;
  onRewriteSelectionModelChange: (value: string | null) => void;
  onRewriteSelectionEffortChange: (value: ReasoningEffort | null) => void;
}

interface ArchivedThreadSectionState {
  exportEnabled: boolean;
  exportFolderTemplate: string;
  exportFilenameTemplate: string;
  exportTags: string;
  threads: readonly Thread[];
  loaded: boolean;
  loading: boolean;
  status: string;
  deleteConfirmThreadId: string | null;
  onExportEnabledChange: (enabled: boolean) => void;
  onExportFolderTemplateChange: (value: string) => void;
  onExportFilenameTemplateChange: (value: string) => void;
  onExportTagsChange: (value: string) => void;
  onRestore: (threadId: string) => void;
  onStartDelete: (threadId: string) => void;
  onDelete: (threadId: string) => void;
}

interface HookSectionState {
  hooks: readonly HookItem[];
  warnings: readonly string[];
  errors: readonly string[];
  loaded: boolean;
  loading: boolean;
  status: string;
  onTrust: (hook: HookItem) => void;
  onToggleEnabled: (hook: HookItem, enabled: boolean) => void;
}

export interface SettingsDynamicSectionsState {
  helper: HelperSettingsState;
  archived: ArchivedThreadSectionState;
  hooks: HookSectionState;
}

export function SettingsDynamicSections({ state }: { state: SettingsDynamicSectionsState }): UiNode {
  return (
    <>
      <HelperSettingsSection state={state.helper} />
      <ArchivedThreadSection state={state.archived} />
      <HookSection state={state.hooks} />
    </>
  );
}

function HelperSettingsSection({ state }: { state: HelperSettingsState }): UiNode {
  return (
    <section className="codex-panel-settings__section codex-panel-settings__helper-section">
      <SettingsHeading name="Codex helpers" />
      <ModelEffortSetting
        name="Automatic thread naming"
        desc="Choose the model and reasoning effort used to suggest thread names."
        modelValue={state.threadNamingModel}
        effortValue={state.threadNamingEffort}
        models={state.models}
        onModelChange={state.onThreadNamingModelChange}
        onEffortChange={state.onThreadNamingEffortChange}
      />
      <ModelEffortSetting
        name="Selection rewrite"
        desc="Choose the model and reasoning effort used by rewrite selection."
        modelValue={state.rewriteSelectionModel}
        effortValue={state.rewriteSelectionEffort}
        models={state.models}
        onModelChange={state.onRewriteSelectionModelChange}
        onEffortChange={state.onRewriteSelectionEffortChange}
      />
      {state.modelLoadFailed ? <p className="setting-item-description codex-panel-settings__section-status">{state.modelStatus}</p> : null}
    </section>
  );
}

function ModelEffortSetting({
  name,
  desc,
  modelValue,
  effortValue,
  models,
  onModelChange,
  onEffortChange,
}: {
  name: string;
  desc: string;
  modelValue: string | null;
  effortValue: ReasoningEffort | null;
  models: readonly ModelMetadata[];
  onModelChange: (value: string | null) => void;
  onEffortChange: (value: ReasoningEffort | null) => void;
}): UiNode {
  const efforts = effortOptions(models, modelValue);
  return (
    <SettingRow name={name} desc={desc}>
      <SelectControl
        value={modelValue ?? CODEX_DEFAULT_VALUE}
        onChange={(value) => {
          onModelChange(value === CODEX_DEFAULT_VALUE ? null : value);
        }}
      >
        {modelOptions(models, modelValue).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectControl>
      <SelectControl
        value={effortValue ?? CODEX_DEFAULT_VALUE}
        onChange={(value) => {
          onEffortChange(value === CODEX_DEFAULT_VALUE ? null : value);
        }}
      >
        {reasoningEffortOptions(efforts, effortValue).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </SelectControl>
    </SettingRow>
  );
}

function ArchivedThreadSection({ state }: { state: ArchivedThreadSectionState }): UiNode {
  return (
    <section className="codex-panel-settings__dynamic-section codex-panel-settings__archived-section">
      <SettingsHeading
        dynamic
        name="Thread archiving"
        desc="Choose the default archive behavior and configure saved thread notes. Thread lists offer both archive choices; slash commands use the default."
      />
      <ArchiveExportSettings state={state} />
      {state.loaded && state.threads.length === 0 ? (
        <p className="setting-item-description codex-panel-settings__dynamic-section-status">No archived threads.</p>
      ) : state.loaded ? (
        <ArchivedThreadList state={state} />
      ) : !state.loading && state.status ? (
        <p className="setting-item-description codex-panel-settings__dynamic-section-status">{state.status}</p>
      ) : null}
    </section>
  );
}

function ArchiveExportSettings({ state }: { state: ArchivedThreadSectionState }): UiNode {
  return (
    <>
      <SettingRow
        name="Save note by default"
        desc="When on, the default archive action saves a markdown note before archiving. When off, the default archives without saving. If saving fails, the thread stays active. Frontmatter includes title, thread_id, created, and optional tags."
      >
        <ToggleControl
          checked={state.exportEnabled}
          onChange={(checked) => {
            state.onExportEnabledChange(checked);
          }}
        />
      </SettingRow>
      <SettingRow name="Saved note folder" desc="Vault-relative folder for saved thread notes. The folder is created when needed.">
        <TextControl
          placeholder="Codex archives"
          value={state.exportFolderTemplate}
          onChange={(value) => {
            state.onExportFolderTemplateChange(value);
          }}
        />
      </SettingRow>
      <SettingRow
        name="Saved note filename"
        desc="Filename template. Variables: {{date}}, {{time}}, {{title}}, {{id}}, {{shortId}}. Existing files get a numeric suffix."
      >
        <TextControl
          placeholder="{{date}} {{time}} {{title}} {{shortId}}.md"
          value={state.exportFilenameTemplate}
          onChange={(value) => {
            state.onExportFilenameTemplateChange(value);
          }}
        />
      </SettingRow>
      <SettingRow name="Saved note tags" desc="Comma-separated fixed tags for saved notes. Leave empty to omit tags.">
        <TextControl
          placeholder="Codex, archive"
          value={state.exportTags}
          onChange={(value) => {
            state.onExportTagsChange(value);
          }}
        />
      </SettingRow>
    </>
  );
}

function ArchivedThreadList({ state }: { state: ArchivedThreadSectionState }): UiNode {
  return (
    <>
      <p className="setting-item-description codex-panel-settings__dynamic-list-summary">
        Restore archived threads, or permanently delete archived threads you no longer need.
      </p>
      <div className="setting-items codex-panel-settings__dynamic-list codex-panel-settings__archived-list">
        {state.threads.map((thread) => (
          <ArchivedThreadRow key={thread.id} thread={thread} state={state} />
        ))}
      </div>
    </>
  );
}

function ArchivedThreadRow({ thread, state }: { thread: Thread; state: ArchivedThreadSectionState }): UiNode {
  const title = archivedThreadDisplayTitle(thread);
  const deleteConfirming = state.deleteConfirmThreadId === thread.id;
  return (
    <SettingRow
      className={`codex-panel-settings__dynamic-row codex-panel-settings__archived-row ${
        deleteConfirming ? "codex-panel-settings__archived-row--delete-confirming" : ""
      }`}
      name={title}
      desc={
        deleteConfirming
          ? "Permanently delete this archived thread? This cannot be undone."
          : `Updated ${formatThreadDate(thread.updatedAt)} · ${shortThreadId(thread.id)}`
      }
    >
      {!deleteConfirming ? (
        <SettingsIconButton
          icon="rotate-ccw"
          label={`Restore ${title}`}
          className="codex-panel-settings__archived-restore"
          onClick={() => {
            state.onRestore(thread.id);
          }}
        />
      ) : null}
      <SettingsIconButton
        icon={deleteConfirming ? "check" : "shredder"}
        label={deleteConfirming ? `Confirm permanent delete ${title}` : `Delete ${title}`}
        className={deleteConfirming ? "codex-panel-settings__archived-delete-confirm" : "codex-panel-settings__archived-delete"}
        onClick={() => {
          if (deleteConfirming) {
            state.onDelete(thread.id);
          } else {
            state.onStartDelete(thread.id);
          }
        }}
      />
    </SettingRow>
  );
}

function HookSection({ state }: { state: HookSectionState }): UiNode {
  return (
    <section className="codex-panel-settings__dynamic-section codex-panel-settings__hook-section">
      <SettingsHeading dynamic name="Hook status" desc="Review discovered hooks, trust changes, and turn hooks on or off." />
      {state.loaded ? (
        <Hooks state={state} />
      ) : !state.loading && state.status ? (
        <p className="setting-item-description codex-panel-settings__dynamic-section-status">{state.status}</p>
      ) : null}
    </section>
  );
}

function Hooks({ state }: { state: HookSectionState }): UiNode {
  return (
    <>
      {state.hooks.length === 0 ? (
        <p className="setting-item-description">No hooks found for this vault root.</p>
      ) : (
        <div className="setting-items codex-panel-settings__dynamic-list codex-panel-settings__hook-list">
          {state.hooks.map((hook) => (
            <HookRow key={hook.key} hook={hook} state={state} />
          ))}
        </div>
      )}
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
      extraInfo={<div className="codex-panel-settings__hook-hash">{hook.currentHash}</div>}
    >
      <button
        type="button"
        disabled={state.loading || !canTrust}
        onClick={() => {
          state.onTrust(hook);
        }}
      >
        Trust
      </button>
      <button
        type="button"
        disabled={state.loading || hook.isManaged}
        onClick={() => {
          state.onToggleEnabled(hook, !hook.enabled);
        }}
      >
        {hook.enabled ? "Disable" : "Enable"}
      </button>
    </SettingRow>
  );
}

function SettingsHeading({ name, desc, dynamic = false }: { name: string; desc?: string; dynamic?: boolean }): UiNode {
  return (
    <div
      className={`${dynamic ? "codex-panel-settings__dynamic-section-heading" : "codex-panel-settings__section-heading"} setting-item setting-item-heading`}
    >
      <div className="setting-item-info">
        <div className="setting-item-description">
          <div className="setting-item-name">{name}</div>
          {desc ?? null}
        </div>
      </div>
      <div className="setting-item-control" />
    </div>
  );
}

function SettingRow({
  name,
  desc,
  className = "",
  extraInfo,
  children,
}: {
  name: string;
  desc: string;
  className?: string;
  extraInfo?: UiNode;
  children: UiNode;
}): UiNode {
  return (
    <div className={`setting-item ${className}`.trim()}>
      <div className="setting-item-info">
        <div className="setting-item-description">
          <div className="setting-item-name">{name}</div>
          {desc}
          {extraInfo}
        </div>
      </div>
      <div className="setting-item-control">{children}</div>
    </div>
  );
}

function SettingsIconButton({
  icon,
  label,
  className,
  onClick,
}: {
  icon: string;
  label: string;
  className: string;
  onClick: () => void;
}): UiNode {
  return (
    <IconButton
      icon={icon}
      label={label}
      className={`clickable-icon extra-setting-button ${className}`}
      onPointerDown={(event: TargetedPointerEvent<HTMLButtonElement>) => {
        event.stopPropagation();
      }}
      onClick={(event: TargetedMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    />
  );
}

function SelectControl({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: UiNode }): UiNode {
  return (
    <select
      className="dropdown"
      value={value}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
    >
      {children}
    </select>
  );
}

function TextControl({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (value: string) => void }): UiNode {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
    />
  );
}

function ToggleControl({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }): UiNode {
  return (
    <div
      className={`checkbox-container ${checked ? "is-enabled" : ""}`}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        onChange(!checked);
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
      />
    </div>
  );
}

function modelOptions(models: readonly ModelMetadata[], current: string | null): { value: string; label: string }[] {
  const options = [{ value: CODEX_DEFAULT_VALUE, label: "Codex default" }];
  if (current && !models.some((model) => model.model === current || model.id === current)) {
    options.push({ value: current, label: `${current} (saved)` });
  }
  for (const model of models) {
    options.push({ value: model.model, label: model.model });
  }
  return options;
}

function effortOptions(models: readonly ModelMetadata[], modelIdOrName: string | null): ReasoningEffort[] {
  const model = selectedModel(models, modelIdOrName);
  return model ? supportedEffortsForModelMetadata(model) : [];
}

function reasoningEffortOptions(efforts: readonly ReasoningEffort[], current: ReasoningEffort | null): { value: string; label: string }[] {
  const options = [{ value: CODEX_DEFAULT_VALUE, label: "Codex default" }];
  if (current && !efforts.includes(current)) {
    options.push({ value: current, label: `${current} (saved)` });
  }
  for (const effort of efforts) {
    options.push({ value: effort, label: effort });
  }
  return options;
}

function selectedModel(models: readonly ModelMetadata[], modelIdOrName: string | null): ModelMetadata | null {
  if (!modelIdOrName) return null;
  return models.find((model) => model.model === modelIdOrName || model.id === modelIdOrName) ?? null;
}

function supportedEffortsForModelMetadata(model: ModelMetadata): ReasoningEffort[] {
  return [...model.supportedReasoningEfforts];
}

function firstNonEmptyString(...values: (string | null | undefined)[]): string {
  return (
    values.find((value): value is string => typeof value === "string" && value.length > 0) ??
    values.find((value): value is string => typeof value === "string") ??
    ""
  );
}

function formatThreadDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "unknown";
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
