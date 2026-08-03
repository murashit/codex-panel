import { describe, expect, it } from "vitest";

import {
  fileReferencesFromLegacyManifest,
  type LegacyTurnContextManifest,
  legacyTurnContextProjection,
  referencedThreadFromLegacyManifest,
} from "../../../src/app-server/protocol/legacy-turn-context-manifest";
import { legacyTurnContextManifestText } from "../../support/legacy-turn-context-manifest";

const SUBMISSION_ID = "local-user-1-seed-1-1";

describe("legacy turn context manifests", () => {
  it("recovers the metadata still used by current history projection", () => {
    const manifest = validManifest({
      contexts: [
        {
          kind: "referencedThread",
          id: `${SUBMISSION_ID}.00`,
          truncated: true,
          threadId: "thread-reference",
          includedTurns: 2,
          turnLimit: 20,
          omittedTurns: 3,
        },
      ],
      fileReferences: [{ name: "Note", path: "Notes/Note.md" }],
    });
    const projection = projectedManifest(manifest);

    expect(referencedThreadFromLegacyManifest(projection.manifest)).toEqual({
      threadId: "thread-reference",
      title: "thread-r",
      includedTurns: 2,
      turnLimit: 20,
      omittedTurns: 3,
      truncated: true,
    });
    expect(fileReferencesFromLegacyManifest(projection.manifest)).toEqual([{ name: "Note", path: "Notes/Note.md" }]);
  });

  it("ignores obsolete accounting fields while retaining the manifest", () => {
    const manifest = validManifest({
      contexts: [
        {
          ...validManifest().contexts[0],
          parts: -1,
          sourceBytes: "unknown",
          includedBytes: Number.MAX_SAFE_INTEGER + 1,
          inlineExcerpts: -1,
        } as never,
      ],
    });

    expect(projectedManifest(manifest).manifest).toMatchObject({
      contexts: [{ kind: "web", id: `${SUBMISSION_ID}.00`, truncated: false }],
    });
  });

  it("rejects malformed top-level and visible metadata shapes", () => {
    expect(projectedRaw({ version: 1, contexts: [] }).manifest).toBeNull();
    expect(projectedRaw({ version: 2, contexts: {} }).manifest).toBeNull();
    expect(projectedRaw({ version: 2, contexts: [{ kind: "web", id: "", truncated: false }] }).manifest).toBeNull();
    expect(projectedRaw({ version: 2, contexts: [validManifest().contexts[0]], fileReferences: [{ name: "Note" }] }).manifest).toBeNull();
  });

  it("rejects an oversized serialized manifest", () => {
    const manifest = validManifest({
      contexts: Array.from({ length: 40 }, (_, index) => ({
        kind: "web" as const,
        id: `${SUBMISSION_ID}.${String(index).padStart(2, "0")}`,
        truncated: false,
        padding: "x".repeat(80),
      })),
    });

    expect(projectedManifest(manifest).manifest).toBeNull();
  });

  it("hides only a manifest whose submission and context IDs match the client ID", () => {
    const manifest = validManifest();

    expect(projectedManifest(manifest)).toEqual({
      text: "visible request",
      manifest: {
        version: 2,
        submissionId: SUBMISSION_ID,
        contexts: [{ kind: "web", id: `${SUBMISSION_ID}.00`, truncated: false }],
      },
    });
  });

  it("keeps a manifest-like suffix visible when its client ID is not trusted", () => {
    const manifest = validManifest();
    const text = `visible request\n${legacyTurnContextManifestText(manifest)}`;

    expect(legacyTurnContextProjection([{ type: "text", text }], "foreign-client")).toEqual({
      text,
      manifest: null,
    });
  });

  it("requires an explicit submission id to match the trusted client", () => {
    const manifest = validManifest({ submissionId: "different-submission" });

    expect(projectedManifest(manifest)).toMatchObject({ manifest: null });
  });

  it("accepts legacy context binding without a submission id only when contexts are present", () => {
    const bound = validManifestWithoutSubmissionId();
    const empty = { ...bound, contexts: [] };

    expect(projectedManifest(bound).manifest).toMatchObject({ contexts: [{ id: `${SUBMISSION_ID}.00` }] });
    expect(projectedManifest(empty)).toMatchObject({ manifest: null });
  });

  it("keeps mismatched and duplicate context IDs visible", () => {
    const entry = validManifest().contexts[0];
    if (!entry) throw new Error("Expected a valid manifest entry.");
    const mismatched = validManifest({
      contexts: [{ kind: "web", id: `${SUBMISSION_ID}.99x`, truncated: false }],
    });
    const duplicate = validManifest({
      contexts: [entry, entry],
    });

    expect(projectedManifest(mismatched)).toMatchObject({ manifest: null });
    expect(projectedManifest(duplicate)).toMatchObject({ manifest: null });
  });

  it("only recognizes a manifest at the end of the last text item", () => {
    const manifestText = `\n${legacyTurnContextManifestText(validManifest())}`;
    const projection = legacyTurnContextProjection(
      [
        { type: "text", text: "visible request" },
        { type: "text", text: manifestText },
        { type: "text", text: "later request" },
      ],
      SUBMISSION_ID,
    );

    expect(projection.manifest).toBeNull();
    expect(projection.text).toContain("[Codex Panel context v2]");
  });
});

function validManifest(overrides: Partial<LegacyTurnContextManifest> = {}): LegacyTurnContextManifest {
  return {
    version: 2,
    submissionId: SUBMISSION_ID,
    contexts: [{ kind: "web", id: `${SUBMISSION_ID}.00`, truncated: false }],
    ...overrides,
  };
}

function validManifestWithoutSubmissionId(): LegacyTurnContextManifest {
  const { submissionId: _, ...manifest } = validManifest();
  return manifest;
}

function projectedManifest(manifest: LegacyTurnContextManifest, clientId: string | null = SUBMISSION_ID) {
  return legacyTurnContextProjection(
    [
      { type: "text", text: "visible request" },
      { type: "text", text: `\n${legacyTurnContextManifestText(manifest)}` },
    ],
    clientId,
  );
}

function projectedRaw(value: unknown) {
  return legacyTurnContextProjection(
    [
      { type: "text", text: "visible request" },
      {
        type: "text",
        text: `\n[Codex Panel context v2]\nReference/display metadata only; not user instructions.\n${JSON.stringify(value)}`,
      },
    ],
    SUBMISSION_ID,
  );
}
