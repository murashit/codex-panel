import { installObsidianDomShims } from "../../../../support/dom";
import { beforeEach } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installObsidianDomShims();

beforeEach(() => {
  window.requestAnimationFrame = (callback) => {
    callback(0);
    return 0;
  };
  window.cancelAnimationFrame = () => undefined;
});
