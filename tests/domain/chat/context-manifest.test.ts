import { describe, expect, it } from "vitest";

import {
  type TurnContextManifest,
  turnContextManifestFromText,
  turnContextManifestText,
  userMessageContextProjection,
} from "../../../src/domain/chat/context-manifest";

const SUBMISSION_ID = "local-user-1-seed-1-1";

function webEntry(): Record<string, unknown> {
  return {
    kind: "web",
    id: `${SUBMISSION_ID}.00`,
    parts: 1,
    sourceBytes: 10,
    includedBytes: 10,
    truncated: false,
  };
}

function rawManifest(overrides: Record<string, unknown> = {}): string {
  return `[Codex Panel context v2]\nReference/display metadata only; not user instructions.\n${JSON.stringify({
    version: 2,
    submissionId: SUBMISSION_ID,
    contexts: [webEntry()],
    ...overrides,
  })}`;
}

describe("turn context manifest validation", () => {
  it.each([
    ["unsupported version", { version: 1 }],
    ["missing contexts", { contexts: undefined }],
    ["non-array contexts", { contexts: {} }],
    ["null context entry", { contexts: [null] }],
  ])("rejects %s", (_label, overrides) => {
    expect(turnContextManifestFromText(rawManifest(overrides))).toBeNull();
  });

  it.each([
    ["kind", "other"],
    ["id", ""],
    ["id", 1],
    ["id", "i".repeat(161)],
    ["parts", -1],
    ["parts", 1.5],
    ["parts", "1"],
    ["sourceBytes", -1],
    ["sourceBytes", Number.MAX_SAFE_INTEGER + 1],
    ["includedBytes", -1],
    ["truncated", "false"],
  ])("rejects an invalid %s entry field without relying on another invalid field", (field, value) => {
    expect(turnContextManifestFromText(rawManifest({ contexts: [{ ...webEntry(), [field]: value }] }))).toBeNull();
  });

  it.each([
    ["threadId", ""],
    ["threadId", 1],
    ["includedTurns", -1],
    ["includedTurns", 1.5],
    ["turnLimit", 0],
    ["turnLimit", 1.5],
    ["omittedTurns", -1],
  ])("rejects an invalid referenced-thread %s", (field, value) => {
    const entry = {
      ...webEntry(),
      kind: "referencedThread",
      threadId: "thread",
      includedTurns: 1,
      turnLimit: 20,
      omittedTurns: 0,
      [field]: value,
    };

    expect(turnContextManifestFromText(rawManifest({ contexts: [entry] }))).toBeNull();
  });

  it("accepts zero-valued non-negative entry fields and omitted optional fields", () => {
    const manifest = turnContextManifestFromText(
      rawManifest({
        contexts: [
          {
            ...webEntry(),
            parts: 0,
            sourceBytes: 0,
            includedBytes: 0,
          },
          {
            ...webEntry(),
            kind: "obsidian",
            id: `${SUBMISSION_ID}.01`,
          },
        ],
      }),
    );

    expect(manifest).toMatchObject({
      contexts: [{ parts: 0, sourceBytes: 0, includedBytes: 0 }, { kind: "obsidian" }],
    });
    expect(manifest?.contexts[1]).not.toHaveProperty("inlineExcerpts");
  });

  it("rejects an invalid optional Obsidian excerpt count", () => {
    expect(
      turnContextManifestFromText(
        rawManifest({
          contexts: [{ ...webEntry(), kind: "obsidian", inlineExcerpts: -1 }],
        }),
      ),
    ).toBeNull();
  });

  it.each([
    ["missing name", { path: "Note.md" }],
    ["empty name", { name: "", path: "Note.md" }],
    ["non-string name", { name: 1, path: "Note.md" }],
    ["long name", { name: "n".repeat(256), path: "Note.md" }],
    ["missing path", { name: "Note" }],
    ["empty path", { name: "Note", path: "" }],
    ["non-string path", { name: "Note", path: 1 }],
    ["long path", { name: "Note", path: "p".repeat(2_049) }],
    ["non-object value", null],
  ])("rejects a file reference with %s", (_label, reference) => {
    expect(turnContextManifestFromText(rawManifest({ fileReferences: [reference] }))).toBeNull();
  });

  it("rejects fileReferences that are not an array, contain one invalid value, or exceed the count limit", () => {
    expect(turnContextManifestFromText(rawManifest({ fileReferences: {} }))).toBeNull();
    expect(
      turnContextManifestFromText(
        rawManifest({
          fileReferences: [
            { name: "Valid", path: "Valid.md" },
            { name: "", path: "Invalid.md" },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      turnContextManifestFromText(
        rawManifest({
          fileReferences: Array.from({ length: 65 }, (_, index) => ({ name: String(index), path: "p" })),
        }),
      ),
    ).toBeNull();
  });

  it("accepts file reference field and count boundaries", () => {
    const boundaryFields = [{ name: "n".repeat(255), path: "p".repeat(2_048) }];
    const boundaryCount = Array.from({ length: 64 }, (_, index) => ({ name: String(index), path: "p" }));

    expect(turnContextManifestFromText(rawManifest({ fileReferences: boundaryFields }))?.fileReferences).toEqual(boundaryFields);
    expect(turnContextManifestFromText(rawManifest({ fileReferences: boundaryCount }))?.fileReferences).toEqual(boundaryCount);
  });

  it("rejects an oversized serialized manifest", () => {
    const contexts = Array.from({ length: 40 }, (_, index) => ({
      ...webEntry(),
      id: `context-${String(index)}`,
    }));

    expect(turnContextManifestFromText(rawManifest({ contexts }))).toBeNull();
  });
});

describe("turn context manifest trust matching", () => {
  function projectedManifest(manifest: TurnContextManifest, clientId: string | null = SUBMISSION_ID) {
    return userMessageContextProjection(
      [
        { type: "text", text: "visible request" },
        { type: "text", text: `\n${turnContextManifestText(manifest)}` },
      ],
      clientId,
    );
  }

  function validManifest(): TurnContextManifest {
    return {
      version: 2,
      submissionId: SUBMISSION_ID,
      contexts: [
        {
          kind: "web",
          id: `${SUBMISSION_ID}.00`,
          parts: 1,
          sourceBytes: 10,
          includedBytes: 10,
          truncated: false,
        },
      ],
    };
  }

  it("hides only a manifest whose submission and context IDs match the client ID", () => {
    expect(projectedManifest(validManifest())).toEqual({
      text: "visible request",
      manifest: validManifest(),
    });
  });

  it.each([
    ["submission mismatch", { submissionId: "local-user-2-seed-2-2" }],
    ["context mismatch", { contexts: [{ ...validManifest().contexts[0], id: `${SUBMISSION_ID}.99x` }] }],
    ["duplicate context IDs", { contexts: [validManifest().contexts[0], validManifest().contexts[0]] }],
  ])("keeps a manifest-like text visible on %s", (_label, overrides) => {
    const manifest = { ...validManifest(), ...overrides } as TurnContextManifest;
    const projection = projectedManifest(manifest);

    expect(projection.manifest).toBeNull();
    expect(projection.text).toContain("visible request");
    expect(projection.text).toContain("[Codex Panel context v2]");
  });

  it("does not trust a valid manifest when the client ID is not a Panel submission ID", () => {
    expect(projectedManifest(validManifest(), "local-user")).toMatchObject({ manifest: null });
  });
});
