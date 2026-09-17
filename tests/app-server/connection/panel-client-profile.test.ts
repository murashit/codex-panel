import { describe, expect, it } from "vitest";
import manifest from "../../../manifest.json";
import compatibility from "../../../src/app-server/compatibility.json";
import { codexPanelAppServerInitializeParams } from "../../../src/app-server/connection/client-profile";

describe("codexPanelAppServerInitializeParams", () => {
  it("builds the panel initialize profile from compatibility policy and manifest version", () => {
    expect(codexPanelAppServerInitializeParams()).toEqual({
      clientInfo: {
        name: "obsidian_codex_panel",
        title: "Codex Panel",
        version: manifest.version,
      },
      capabilities: compatibility.codexAppServer.initialize.capabilities,
    });
  });
});
