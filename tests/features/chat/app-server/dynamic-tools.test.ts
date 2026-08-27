import { describe, expect, it, vi } from "vitest";

import { panelDynamicTools } from "../../../../src/features/chat/app-server/adapters/dynamic-tool-registration";
import { executePanelDynamicTool } from "../../../../src/features/chat/application/dynamic-tools";

describe("Codex Panel dynamic tools", () => {
  it("registers a namespaced resolve_wikilinks function", () => {
    expect(panelDynamicTools()).toEqual([
      expect.objectContaining({
        type: "namespace",
        name: "codex_panel",
        tools: [
          expect.objectContaining({
            type: "function",
            name: "resolve_wikilinks",
            inputSchema: expect.objectContaining({
              required: ["wikilinks"],
              additionalProperties: false,
            }),
          }),
        ],
      }),
    ]);
  });

  it("serializes successful resolver output for the model", () => {
    const result = { schemaVersion: 1, results: [{ resolvedPath: "Notes/Target.md" }] };
    const resolveWikilinks = vi.fn(() => result);

    const response = executePanelDynamicTool(toolCall(), { resolveWikilinks });

    expect(resolveWikilinks).toHaveBeenCalledWith({ sourcePath: "Notes/Source.md", wikilinks: ["[[Target]]"] });
    expect(response).toEqual({
      success: true,
      contentItems: [{ type: "inputText", text: JSON.stringify(result) }],
    });
  });

  it.each([
    { namespace: null, tool: "resolve_wikilinks" },
    { namespace: "other", tool: "resolve_wikilinks" },
    { namespace: "codex_panel", tool: "other" },
  ])("returns a tool failure for unknown $namespace.$tool calls", ({ namespace, tool }) => {
    const resolveWikilinks = vi.fn();

    const response = executePanelDynamicTool({ ...toolCall(), namespace, tool }, { resolveWikilinks });

    expect(response.success).toBe(false);
    expect(response.contentItems[0]).toMatchObject({ type: "inputText", text: expect.stringContaining("Unknown") });
    expect(resolveWikilinks).not.toHaveBeenCalled();
  });

  it("returns validation failures without rejecting the JSON-RPC request", () => {
    const response = executePanelDynamicTool(toolCall(), {
      resolveWikilinks: () => {
        throw new Error("Invalid raw wikilink: target");
      },
    });

    expect(response).toEqual({
      success: false,
      contentItems: [{ type: "inputText", text: "Invalid raw wikilink: target" }],
    });
  });
});

function toolCall() {
  return {
    threadId: "thread",
    turnId: "turn",
    callId: "call",
    namespace: "codex_panel",
    tool: "resolve_wikilinks",
    arguments: { sourcePath: "Notes/Source.md", wikilinks: ["[[Target]]"] },
  };
}
