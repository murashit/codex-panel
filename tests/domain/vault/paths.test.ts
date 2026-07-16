import { describe, expect, it } from "vitest";
import { pathRelativeToRoot } from "../../../src/domain/vault/paths";

describe("pathRelativeToRoot", () => {
  it("keeps Windows sibling paths outside the workspace root", () => {
    expect(pathRelativeToRoot("C:\\Vault\\project\\src\\main.ts", "C:\\Vault\\project")).toBe("src/main.ts");
    expect(pathRelativeToRoot("C:\\Vault\\project-other\\src\\main.ts", "C:\\Vault\\project")).toBe("C:/Vault/project-other/src/main.ts");
  });
});
