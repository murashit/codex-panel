import type { State } from "../application/state/store";
import { addDomEventListener } from "../../../../shared/dom/events.dom";
import { renderPreactRoot } from "../../../../shared/dom/preact-root.dom";

export function Escape(props: { state: State }): JSX.Element {
  document.body.append(document.createElement("div"));
  void addDomEventListener;
  void renderPreactRoot;
  return <input defaultValue={String(props.state)} />;
}
