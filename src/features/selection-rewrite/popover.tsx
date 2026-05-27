import { Notice, type Editor } from "obsidian";
import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

import { renderDisplayDiffLines } from "../../shared/diff/render";
import { displayDiffLines } from "../../shared/diff/unified";
import { IconButton } from "../../shared/ui/react-components";
import { renderReactRoot, unmountReactRoot } from "../../shared/ui/react-root";
import { syncTextareaHeight } from "../../shared/ui/textarea-autogrow";
import { buildSelectionUnifiedDiff } from "./diff";
import { isSelectionRewriteActionKey, isSelectionRewriteGenerateKey } from "./keys";
import { canApplySelectionRewrite, type SelectionRewriteRuntimeSettings, type SelectionRewriteSession } from "./model";
import { SelectionRewriteOutputError } from "./output";
import { positionSelectionRewritePopover } from "./position";
import { buildSelectionRewritePrompt } from "./prompt";
import { runSelectionRewrite, type SelectionRewriteActivity } from "./runner";
import type { SendShortcut } from "../../shared/ui/keyboard";

const POPOVER_MARGIN = 8;

export interface SelectionRewritePopoverOptions {
  codexPath: string;
  cwd: string;
  editor: Editor;
  onClose?: () => void;
  runtimeSettings: SelectionRewriteRuntimeSettings;
  sendShortcut: SendShortcut;
  session: SelectionRewriteSession;
}

type Cleanup = () => void;

interface SelectionRewriteElements {
  root: HTMLElement;
  instruction: HTMLTextAreaElement | null;
  applyButton: HTMLButtonElement | null;
}

export class SelectionRewritePopover {
  private elements: SelectionRewriteElements | null = null;
  private abortController: AbortController | null = null;
  private readonly cleanups: Cleanup[] = [];
  private instructionDraft: string;
  private statusText = "";
  private statusActive = false;

  constructor(private readonly options: SelectionRewritePopoverOptions) {
    this.instructionDraft = options.session.instruction;
  }

  open(): void {
    this.close();

    const elements = this.createElements();
    this.elements = elements;

    this.addDomListener(activeWindow, "resize", () => {
      this.position();
    });
    this.addDomListener(
      activeWindow,
      "scroll",
      () => {
        this.position();
      },
      true,
    );
    this.addDomListener(activeDocument, "keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.cancel();
      }
    });

    this.setStatus("");
    this.syncInstructionHeight();
    this.syncControls();
    this.position();
    elements.instruction?.focus();
  }

  close(): void {
    const hadElements = this.elements !== null;
    if (!hadElements && this.options.session.status !== "generating") return;
    if (this.options.session.status === "generating") {
      this.abortController?.abort();
    }
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    if (this.elements) {
      unmountReactRoot(this.elements.root);
      this.elements.root.remove();
    }
    this.elements = null;
    this.options.onClose?.();
  }

  private async generate(): Promise<void> {
    if (this.options.session.status === "generating") return;
    const instruction = this.instructionDraft.trim();
    if (!instruction) {
      new Notice("Enter a rewrite instruction first.");
      this.elements?.instruction?.focus();
      return;
    }

    this.startGeneration(instruction);
    this.setStatus("Generating", { active: true });
    this.syncControls();
    const abortController = new AbortController();
    this.abortController = abortController;

    try {
      const output = await runSelectionRewrite({
        codexPath: this.options.codexPath,
        cwd: this.options.cwd,
        prompt: buildSelectionRewritePrompt(this.options.session),
        runtimeSettings: this.options.runtimeSettings,
        onActivity: (activity) => {
          this.updateActivity(activity);
        },
        onPreview: (text) => {
          this.updatePreview(text);
        },
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) return;
      this.showSelectionRewritePreview(output.replacementText);
    } catch (error) {
      if (abortController.signal.aborted) {
        this.options.session.status = "cancelled";
        return;
      }
      this.showGenerationFailure(error);
    } finally {
      if (this.abortController === abortController) this.abortController = null;
      this.syncControls();
      if (this.options.session.status === "preview") this.focusApplyButton();
      this.position();
    }
  }

  private cancel(): void {
    this.options.session.status = "cancelled";
    this.abortController?.abort();
    this.close();
  }

  private updatePreview(text: string): void {
    this.options.session.streamText = text;
    this.setStatus("Writing replacement", { active: true });
    this.position();
  }

  private updateActivity(activity: SelectionRewriteActivity): void {
    this.setStatus(activity === "reasoning" ? "Reasoning" : "Writing replacement", { active: true });
  }

  private createElements(): SelectionRewriteElements {
    const root = activeDocument.body.createDiv({ cls: "codex-panel-selection-rewrite" });
    root.setAttr("role", "dialog");
    root.setAttr("aria-label", "Rewrite selection");
    const elements: SelectionRewriteElements = { root, instruction: null, applyButton: null };
    this.renderView(elements);
    return elements;
  }

  private startGeneration(instruction: string): void {
    this.options.session.instruction = instruction;
    this.options.session.status = "generating";
    this.options.session.streamText = "";
    this.options.session.replacementText = null;
    this.options.session.debugText = null;
    this.renderView();
  }

  private showSelectionRewritePreview(replacementText: string): void {
    this.options.session.replacementText = replacementText;
    this.options.session.status = "preview";
    this.options.session.streamText = "";
    this.setStatus("");
  }

  private showGenerationFailure(error: unknown): void {
    this.options.session.status = "failed";
    this.options.session.debugText = error instanceof SelectionRewriteOutputError ? error.rawText : null;
    this.options.session.streamText = "";
    this.setStatus(error instanceof Error ? error.message : String(error));
  }

  private apply(): void {
    const replacement = this.options.session.replacementText;
    if (replacement === null) return;

    const { editor, session } = this.options;
    const currentText = editor.getRange(session.targetRange.from, session.targetRange.to);
    if (!canApplySelectionRewrite(currentText, session.originalText)) {
      new Notice("Selection changed. Generate the rewrite again before applying.");
      this.setStatus("Selection changed. Generate the rewrite again before applying.");
      return;
    }

    editor.replaceRange(replacement, session.targetRange.from, session.targetRange.to, "codex-panel-rewrite");
    session.status = "applied";
    this.close();
  }

  private focusApplyButton(): void {
    if (!this.elements?.applyButton || this.elements.applyButton.disabled) return;
    this.elements.applyButton.focus({ preventScroll: true });
  }

  private setStatus(text: string, options: { active?: boolean } = {}): void {
    this.statusText = text;
    this.statusActive = Boolean(options.active);
    this.renderView();
  }

  private syncControls(): void {
    this.renderView();
  }

  private syncInstructionHeight(): void {
    const instruction = this.elements?.instruction ?? null;
    syncTextareaHeight(instruction, {
      minHeightFallback: 56,
      maxHeightFallback: instruction ? Math.min(180, instruction.win.innerHeight * 0.3) : 180,
    });
  }

  private position(): void {
    if (!this.elements) return;
    if (!positionSelectionRewritePopover(this.elements.root, this.options.editor, POPOVER_MARGIN)) this.close();
  }

  private renderView(elements: SelectionRewriteElements | null = this.elements): void {
    if (!elements) return;
    const session = this.options.session;
    const replacement = session.replacementText;
    renderReactRoot(
      elements.root,
      <SelectionRewritePopoverView
        applyButtonRef={(element) => {
          elements.applyButton = element;
        }}
        debugText={session.debugText}
        diff={replacement === null ? null : buildSelectionUnifiedDiff(session.filePath, session.originalText, replacement)}
        generating={session.status === "generating"}
        hasInstruction={Boolean(this.instructionDraft.trim())}
        hasReplacement={replacement !== null}
        instruction={this.instructionDraft}
        instructionRef={(element) => {
          elements.instruction = element;
        }}
        onApply={() => {
          this.apply();
        }}
        onCancel={() => {
          this.cancel();
        }}
        onGenerate={() => void this.generate()}
        onInstructionInput={(value) => {
          this.instructionDraft = value;
          this.syncInstructionHeight();
          this.syncControls();
          this.position();
        }}
        onInstructionKeyDown={(event) => {
          const hasReplacement = this.options.session.replacementText !== null;
          if (
            !(hasReplacement
              ? isSelectionRewriteActionKey(event.nativeEvent)
              : isSelectionRewriteGenerateKey(event.nativeEvent, this.options.sendShortcut))
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          void this.generate();
        }}
        onApplyKeyDown={(event) => {
          if (!isSelectionRewriteActionKey(event.nativeEvent)) return;
          event.preventDefault();
          this.apply();
        }}
        statusActive={this.statusActive}
        statusText={this.statusText}
        streamPreview={session.streamText.trim()}
      />,
    );
  }

  private addDomListener<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    callback: (event: WindowEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  private addDomListener<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    callback: (event: DocumentEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  private addDomListener(
    target: Window | Document,
    type: string,
    callback: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    target.addEventListener(type, callback, options);
    this.cleanups.push(() => {
      target.removeEventListener(type, callback, options);
    });
  }
}

interface SelectionRewritePopoverViewProps {
  applyButtonRef: (element: HTMLButtonElement | null) => void;
  debugText: string | null;
  diff: string | null;
  generating: boolean;
  hasInstruction: boolean;
  hasReplacement: boolean;
  instruction: string;
  instructionRef: (element: HTMLTextAreaElement | null) => void;
  onApply: () => void;
  onApplyKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onCancel: () => void;
  onGenerate: () => void;
  onInstructionInput: (value: string) => void;
  onInstructionKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  statusActive: boolean;
  statusText: string;
  streamPreview: string;
}

function SelectionRewritePopoverView({
  applyButtonRef,
  debugText,
  diff,
  generating,
  hasInstruction,
  hasReplacement,
  instruction,
  instructionRef,
  onApply,
  onApplyKeyDown,
  onCancel,
  onGenerate,
  onInstructionInput,
  onInstructionKeyDown,
  statusActive,
  statusText,
  streamPreview,
}: SelectionRewritePopoverViewProps): ReactNode {
  return (
    <>
      <div className="codex-panel-selection-rewrite__prompt-row">
        <textarea
          ref={instructionRef}
          className="codex-panel-ui__text-input codex-panel-selection-rewrite__instruction"
          disabled={generating}
          onChange={(event) => {
            onInstructionInput(event.currentTarget.value);
          }}
          onKeyDown={onInstructionKeyDown}
          placeholder="How should Codex rewrite this selection?"
          value={instruction}
        />
        <div className="codex-panel-ui__action-stack codex-panel-selection-rewrite__controls">
          <IconButton
            icon="sparkles"
            label={hasReplacement ? "Regenerate" : "Generate"}
            className="clickable-icon codex-panel-ui__icon-button codex-panel-selection-rewrite__icon-button"
            disabled={generating || !hasInstruction}
            onClick={onGenerate}
          />
          <IconButton
            icon="x"
            label="Cancel"
            className="clickable-icon codex-panel-ui__icon-button codex-panel-selection-rewrite__icon-button"
            onClick={onCancel}
          />
        </div>
      </div>
      <SelectionRewriteStatus text={statusText} active={statusActive} />
      <pre className={`codex-panel-selection-rewrite__stream-preview${streamPreview ? "" : " is-hidden"}`}>{streamPreview}</pre>
      <div className={`codex-panel-selection-rewrite__result-row${hasReplacement ? "" : " is-hidden"}`}>
        <div className="codex-panel-selection-rewrite__diff">{diff ? <SelectionRewriteDiff diff={diff} /> : null}</div>
        <IconButton
          buttonRef={applyButtonRef}
          icon="check"
          label="Apply"
          className={`clickable-icon codex-panel-ui__icon-button codex-panel-selection-rewrite__icon-button mod-cta${
            hasReplacement ? "" : " is-hidden"
          }`}
          disabled={generating || !hasReplacement}
          onClick={onApply}
          onKeyDown={onApplyKeyDown}
        />
      </div>
      {debugText ? (
        <details className="codex-panel-selection-rewrite__debug">
          <summary>Debug output</summary>
          <pre>{debugText}</pre>
        </details>
      ) : null}
    </>
  );
}

function SelectionRewriteStatus({ text, active }: { text: string; active: boolean }): ReactNode {
  if (!text && !active) return <div className="codex-panel-selection-rewrite__status" />;
  return (
    <div className={`codex-panel-selection-rewrite__status${active ? " is-active" : ""}`}>
      <span>{text}</span>
      {active ? (
        <span className="codex-panel-selection-rewrite__status-dots">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      ) : null}
    </div>
  );
}

function SelectionRewriteDiff({ diff }: { diff: string }): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.replaceChildren();
    renderSelectionRewriteDiff(element, diff);
  }, [diff]);
  return <div ref={ref} />;
}

function renderSelectionRewriteDiff(parent: HTMLElement, diff: string): void {
  renderDisplayDiffLines(
    parent,
    displayDiffLines(diff).filter((line) => line.kind !== "file" && !line.text.startsWith("@@")),
    { className: "codex-panel-selection-rewrite__diff-body" },
  );
}
