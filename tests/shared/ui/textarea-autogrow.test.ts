// @vitest-environment jsdom

import { afterEach, expect, it } from "vitest";

import { disposeTextareaHeightMirrors, syncTextareaHeight } from "../../../src/shared/ui/textarea-autogrow.measure";
import { installObsidianDomShims } from "../../support/dom";

installObsidianDomShims();

const MIRROR_SELECTOR = ".codex-panel-textarea-height-mirror";

afterEach(disposeTextareaHeightMirrors);

it("reuses each document's textarea mirror and recreates it after full cleanup", () => {
  const documents = [document, document.implementation.createHTMLDocument("secondary")];
  const options = { minHeightFallback: 32, maxHeightFallback: 120 };
  for (const doc of documents) {
    syncTextareaHeight(doc.createElement("textarea"), options);
    const mirror = doc.querySelector(MIRROR_SELECTOR);

    syncTextareaHeight(doc.createElement("textarea"), options);
    expect(doc.querySelectorAll(MIRROR_SELECTOR), `${doc.title || "primary"}: one mirror`).toHaveLength(1);
    expect(doc.querySelector(MIRROR_SELECTOR), `${doc.title || "primary"}: shared mirror`).toBe(mirror);
  }

  expect(document.querySelectorAll(MIRROR_SELECTOR), "primary mirror survives measurement in secondary").toHaveLength(1);
  // Cleanup must also remove duplicates outside the registry.
  document.body.appendChild(document.createElement("textarea")).className = "codex-panel-textarea-height-mirror";

  disposeTextareaHeightMirrors();

  for (const doc of documents) {
    expect(doc.querySelector(MIRROR_SELECTOR), `${doc.title || "primary"}: cleanup removes every mirror`).toBeNull();
    syncTextareaHeight(doc.createElement("textarea"), options);
    expect(doc.querySelectorAll(MIRROR_SELECTOR), `${doc.title || "primary"}: mirror recreated`).toHaveLength(1);
  }
});
