import { describe, expect, it } from "vitest";

import manifest from "../manifest.json";
import { CLIENT_VERSION } from "../src/constants";

describe("constants", () => {
  it("uses the manifest version for the panel client version", () => {
    expect(CLIENT_VERSION).toBe(manifest.version);
  });
});
