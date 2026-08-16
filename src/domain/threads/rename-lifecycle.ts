import type { ThreadTitleContext } from "./title-generation-model";

type ThreadRenameAutoNameState = { kind: "checking" } | { kind: "unavailable" } | { kind: "ready"; context: ThreadTitleContext };

export type ThreadRenameActiveState =
  | { kind: "editing"; draft: string; autoName: ThreadRenameAutoNameState }
  | { kind: "saving"; draft: string; autoName: ThreadRenameAutoNameState }
  | { kind: "generating"; draft: string; autoName: Extract<ThreadRenameAutoNameState, { kind: "ready" }> };
