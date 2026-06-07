import {
  activeComposerThreadName as buildActiveComposerThreadName,
  composerMetaViewModel as buildComposerMetaViewModel,
  composerPlaceholder as buildComposerPlaceholder,
  runtimeComposerChoices,
} from "../model";
import type { ChatViewSlotRendererPorts } from "./types";

export function renderComposerSlot(parent: HTMLElement, ports: ChatViewSlotRendererPorts): void {
  ports.slots.renderComposer(parent);
}

export function composerPlaceholder(ports: ChatViewSlotRendererPorts): string {
  return buildComposerPlaceholder(activeComposerThreadName(ports));
}

export function composerMetaViewModel(ports: ChatViewSlotRendererPorts) {
  return {
    ...buildComposerMetaViewModel(ports.state.chat(), ports.runtime.snapshot()),
    ...runtimeComposerChoices({
      state: ports.state.chat(),
      snapshot: ports.runtime.snapshot(),
      setRequestedModel: (model) => void ports.runtime.setRequestedModel(model),
      setRequestedReasoningEffort: (effort) => void ports.runtime.setRequestedReasoningEffort(effort),
    }),
  };
}

export function activeComposerThreadName(ports: ChatViewSlotRendererPorts): string | null {
  return buildActiveComposerThreadName(ports.state.chat(), ports.thread.restoredPlaceholder());
}
