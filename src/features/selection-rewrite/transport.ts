import type { SelectionRewriteRuntimeSettings } from "./model";
import type { SelectionRewriteOutput } from "./output";

export type SelectionRewriteActivity = "reasoning" | "writing";

export interface SelectionRewriteTransportRequest {
  prompt: string;
  runtimeSettings: SelectionRewriteRuntimeSettings;
  onActivity(activity: SelectionRewriteActivity): void;
  onPreview(text: string): void;
  signal: AbortSignal;
}

export interface SelectionRewriteTransport {
  generate(request: SelectionRewriteTransportRequest): Promise<SelectionRewriteOutput>;
}
