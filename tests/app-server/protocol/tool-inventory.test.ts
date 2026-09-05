import { describe, expect, it } from "vitest";
import { mcpServerStatusSummariesFromStatuses } from "../../../src/app-server/protocol/tool-inventory";

describe("MCP status projection", () => {
  it("derives codex app ids from MCP tool prefixes", () => {
    const summaries = mcpServerStatusSummariesFromStatuses([
      {
        name: "codex_apps",
        runtimeStatus: "connected",
        authStatus: "oAuth",
        tools: {
          "github.fetch_issue": { name: "github.fetch_issue" },
          "google_drive.get_document_text": { name: "google_drive.get_document_text" },
          "apple_music.get-track-details-batch": {},
          malformed_tool: { name: "malformed_tool" },
        },
      },
      {
        name: "github",
        runtimeStatus: null,
        authStatus: "oAuth",
        tools: {
          "github.fetch_issue": { name: "github.fetch_issue" },
        },
      },
    ]);

    expect(summaries).toMatchObject([
      {
        name: "codex_apps",
        codexAppIds: ["apple_music", "github", "google_drive"],
      },
      {
        name: "github",
        codexAppIds: [],
      },
    ]);
  });
});
