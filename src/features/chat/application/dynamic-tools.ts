export interface PanelDynamicToolCall {
  readonly threadId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly namespace: string | null;
  readonly tool: string;
  readonly arguments: unknown;
}

export interface PanelDynamicToolResponse {
  readonly contentItems: readonly { readonly type: "inputText"; readonly text: string }[];
  readonly success: boolean;
}

export interface PanelDynamicToolEffects {
  resolveWikilinks(argumentsValue: unknown): unknown;
}

export function executePanelDynamicTool(call: PanelDynamicToolCall, effects: PanelDynamicToolEffects): PanelDynamicToolResponse {
  if (call.namespace !== "codex_panel" || call.tool !== "resolve_wikilinks") {
    return dynamicToolFailure(`Unknown Codex Panel dynamic tool: ${qualifiedToolName(call)}.`);
  }
  try {
    return dynamicToolSuccess(effects.resolveWikilinks(call.arguments));
  } catch (error) {
    return dynamicToolFailure(error instanceof Error ? error.message : String(error));
  }
}

export function dynamicToolFailure(message: string): PanelDynamicToolResponse {
  return { success: false, contentItems: [{ type: "inputText", text: message }] };
}

function dynamicToolSuccess(result: unknown): PanelDynamicToolResponse {
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(result) }] };
}

function qualifiedToolName(call: PanelDynamicToolCall): string {
  return call.namespace ? `${call.namespace}.${call.tool}` : call.tool;
}
