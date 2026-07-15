import { signal } from "@preact/signals";
import type { State } from "../application/state/store";
import type { ReadModel } from "../panel/shell-read-model";

export const escaped = signal(1);
export type Escape = State | ReadModel | Signal<string>;
