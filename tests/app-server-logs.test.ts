import { describe, expect, it } from "vitest";

import { classifyAppServerLog } from "../src/panel/app-server-logs";

describe("app-server log classification", () => {
  it("suppresses raw MCP token refresh stderr", () => {
    expect(classifyAppServerLog('worker quit with fatal: Transport channel closed, when Auth(TokenRefreshFailed("bad"))')).toBeNull();
  });

  it("suppresses non-JSON app-server stderr", () => {
    expect(
      classifyAppServerLog(
        "\u001b[2m2026-05-08T01:27:27.101140Z\u001b[0m \u001b[31mERROR\u001b[0m \u001b[2mcodex_core::tools::router\u001b[0m\u001b[2m:\u001b[0m \u001b[3merror\u001b[0m\u001b[2m=\u001b[0mapply_patch verification failed",
      ),
    ).toBeNull();
    expect(
      classifyAppServerLog(
        "src/generated/app-server/: codex app-server generate-ts --out src/generated/app-serverで生成した型。手編集しない。",
      ),
    ).toBeNull();
  });

  it("classifies JSON app-server errors", () => {
    expect(classifyAppServerLog(JSON.stringify({ level: "ERROR", fields: { message: "boom" }, target: "codex" }))).toEqual({
      kind: "error",
      text: "boom",
    });
  });

  it("suppresses structured apply_patch router verification logs", () => {
    expect(
      classifyAppServerLog(
        JSON.stringify({
          level: "ERROR",
          fields: { message: "apply_patch verification failed: Failed to find expected lines" },
          target: "codex_core::tools::router",
        }),
      ),
    ).toBeNull();
  });
});
