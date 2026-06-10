import {
  activeComposerThreadName as buildActiveComposerThreadName,
  composerMetaViewModel as buildComposerMetaViewModel,
  composerPlaceholder as buildComposerPlaceholder,
  runtimeComposerChoices,
} from "../model";
import type { ChatPanelComposerPorts } from "./types";

export function composerPlaceholder(ports: ChatPanelComposerPorts): string {
  return buildComposerPlaceholder(activeComposerThreadName(ports));
}

export function composerMetaViewModel(ports: ChatPanelComposerPorts) {
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

function activeComposerThreadName(ports: ChatPanelComposerPorts): string | null {
  return buildActiveComposerThreadName(ports.state.chat(), ports.thread.restoredPlaceholder());
}
