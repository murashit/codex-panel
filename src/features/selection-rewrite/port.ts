import type { ReasoningEffort } from "../../domain/runtime/catalog";

export interface SelectionRewriteRuntimeSettings {
  rewriteSelectionModel: string | null;
  rewriteSelectionEffort: ReasoningEffort | null;
}

type SelectionRewriteActivity = "reasoning" | "writing";

interface SelectionRewriteOutput {
  replacementText: string;
}

export class SelectionRewriteOutputError extends Error {
  constructor(
    message: string,
    readonly rawText: string | null,
  ) {
    super(message);
    this.name = "SelectionRewriteOutputError";
  }
}

export interface SelectionRewritePortRequest {
  prompt: string;
  runtimeSettings: SelectionRewriteRuntimeSettings;
  onActivity(activity: SelectionRewriteActivity): void;
  onPreview(text: string): void;
  signal: AbortSignal;
}

export interface SelectionRewritePort {
  generate(request: SelectionRewritePortRequest): Promise<SelectionRewriteOutput>;
}
