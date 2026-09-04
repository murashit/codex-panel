import { describe, expect, it } from "vitest";

import { handleAppServerResourceFact } from "../../../../../src/features/chat/application/connection/server-resource-facts";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { chatStateFixture } from "../../support/state";

describe("server resource facts", () => {
  it("keeps MCP startup status in panel diagnostics", async () => {
    const stateStore = createChatStateStore(chatStateFixture());

    await handleAppServerResourceFact(
      { stateStore },
      {
        type: "mcp-startup-status-updated",
        name: "github",
        status: "ready",
        message: null,
        authenticationIssue: null,
      },
    );

    expect(stateStore.getState().connection.serverDiagnostics.mcpServers).toMatchObject([
      { name: "github", connectionStatus: "connected" },
    ]);
  });

  it("keeps MCP re-authentication failures actionable", async () => {
    const stateStore = createChatStateStore(chatStateFixture());

    await handleAppServerResourceFact(
      { stateStore },
      {
        type: "mcp-startup-status-updated",
        name: "github",
        status: "failed",
        message: "OAuth token expired",
        authenticationIssue: "reauthenticationRequired",
      },
    );

    expect(stateStore.getState().connection.serverDiagnostics.mcpServers).toMatchObject([
      {
        name: "github",
        connectionStatus: "failed",
        message: "OAuth token expired",
        authenticationIssue: "reauthenticationRequired",
      },
    ]);
  });
});
