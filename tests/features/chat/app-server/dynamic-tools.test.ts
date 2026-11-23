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
              type: "object",
              required: ["wikilinks"],
              additionalProperties: false,
              properties: {
                sourcePath: expect.objectContaining({ type: "string", minLength: 1, maxLength: 1024 }),
                wikilinks: expect.objectContaining({
                  type: "array",
                  minItems: 1,
                  maxItems: 16,
                  items: expect.objectContaining({ type: "string", minLength: 4, maxLength: 1024 }),
                }),
              },
            }),
          }),
          ...["list_outgoing_notes", "list_backlink_notes"].map((name) =>
            expect.objectContaining({
              name,
              type: "function",
              inputSchema: expect.objectContaining({ required: ["notePath"], additionalProperties: false }),
            }),
          ),
        ],
      }),
    ]);
  });

  it("serializes successful resolver output for the model", () => {
    const result = { schemaVersion: 1, results: [{ resolvedPath: "Notes/Target.md" }] };
    const resolveWikilinks = vi.fn(() => result);

    const response = executePanelDynamicTool(toolCall(), { resolveWikilinks, listNotes: vi.fn() });

    expect(resolveWikilinks).toHaveBeenCalledWith({ sourcePath: "Notes/Source.md", wikilinks: ["[[Target]]"] });
    expect(response).toEqual({
      success: true,
      contentItems: [{ type: "inputText", text: JSON.stringify(result) }],
    });
  });

  it.each([
    { case: "a missing namespace", namespace: null, tool: "resolve_wikilinks" },
    { case: "another namespace", namespace: "other", tool: "resolve_wikilinks" },
    { case: "an unknown tool", namespace: "codex_panel", tool: "other" },
  ])("returns a tool failure for $case", ({ namespace, tool }) => {
    const resolveWikilinks = vi.fn();

    const response = executePanelDynamicTool({ ...toolCall(), namespace, tool }, { resolveWikilinks, listNotes: vi.fn() });

    expect(response.success).toBe(false);
    expect(response.contentItems[0]).toMatchObject({ type: "inputText", text: expect.stringContaining("Unknown") });
    expect(resolveWikilinks).not.toHaveBeenCalled();
  });

  it("returns validation failures without rejecting the JSON-RPC request", () => {
    const response = executePanelDynamicTool(toolCall(), {
      listNotes: vi.fn(),
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
    namespace: "codex_panel",
    tool: "resolve_wikilinks",
    arguments: { sourcePath: "Notes/Source.md", wikilinks: ["[[Target]]"] },
  };
}
