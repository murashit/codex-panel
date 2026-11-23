import { errorMessage } from "../../../domain/text/error-message";
export interface PanelDynamicToolCall {
  readonly namespace: string | null;
  readonly tool: string;
  readonly arguments: unknown;
}

export interface PanelDynamicToolResponse {
  readonly contentItems: readonly { readonly type: "inputText"; readonly text: string }[];
  readonly success: boolean;
}

export interface PanelDynamicToolEffects {
  listNotes(direction: "outgoing" | "backlink", argumentsValue: unknown): unknown;
  resolveWikilinks(argumentsValue: unknown): unknown;
}

export function executePanelDynamicTool(call: PanelDynamicToolCall, effects: PanelDynamicToolEffects): PanelDynamicToolResponse {
  if (call.namespace !== "codex_panel") {
    return dynamicToolFailure(`Unknown Codex Panel dynamic tool: ${qualifiedToolName(call)}.`);
  }
  try {
    switch (call.tool) {
      case "resolve_wikilinks":
        return dynamicToolSuccess(effects.resolveWikilinks(call.arguments));
      case "list_outgoing_notes":
        return dynamicToolSuccess(effects.listNotes("outgoing", call.arguments));
      case "list_backlink_notes":
        return dynamicToolSuccess(effects.listNotes("backlink", call.arguments));
      default:
        return dynamicToolFailure(`Unknown Codex Panel dynamic tool: ${qualifiedToolName(call)}.`);
    }
  } catch (error) {
    return dynamicToolFailure(errorMessage(error));
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
