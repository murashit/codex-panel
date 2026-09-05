// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { disposeTextareaHeightMirrors, syncTextareaHeight } from "../../../src/shared/dom/textarea-autogrow.measure";
import { installObsidianDomShims } from "../../support/dom";

installObsidianDomShims();

const MIRROR_SELECTOR = ".codex-panel-textarea-height-mirror";

afterEach(() => {
  disposeTextareaHeightMirrors();
  document.body.replaceChildren();
});

describe("textarea auto-grow measurement", () => {
  it("removes tracked mirrors when the plugin lifecycle ends", () => {
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    syncTextareaHeight(textarea, { minHeightFallback: 32, maxHeightFallback: 120 });
    expect(document.querySelector(MIRROR_SELECTOR)).not.toBeNull();

    disposeTextareaHeightMirrors();

    expect(document.querySelector(MIRROR_SELECTOR)).toBeNull();
  });
});
