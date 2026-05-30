import { installObsidianDomShims } from "../../../../support/dom";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installObsidianDomShims();
