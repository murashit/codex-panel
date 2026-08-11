import type { ComponentChild as UiNode } from "preact";

export function SettingsGroup({ className, children }: { className: string; children: UiNode }): UiNode {
  return <section className={`setting-group ${className}`}>{children}</section>;
}

export function SettingsItems({ className = "", children }: { className?: string; children: UiNode }): UiNode {
  return <div className={`setting-items ${className}`.trim()}>{children}</div>;
}

export function SettingsStatusRow({ children }: { children: UiNode }): UiNode {
  return (
    <div className="setting-item codex-panel-settings__status-row">
      <div className="setting-item-info">
        <div className="setting-item-description">{children}</div>
      </div>
      <div className="setting-item-control" />
    </div>
  );
}

export function SettingsHeading({ name, desc, dynamic = false }: { name: string; desc?: string; dynamic?: boolean }): UiNode {
  return (
    <div
      className={`${dynamic ? "codex-panel-settings__dynamic-section-heading" : "codex-panel-settings__section-heading"} setting-item setting-item-heading`}
    >
      <div className="setting-item-info">
        <div className="setting-item-name">{name}</div>
        {desc ? <div className="setting-item-description">{desc}</div> : null}
      </div>
      <div className="setting-item-control" />
    </div>
  );
}

export function SettingRow({
  name,
  desc,
  className = "",
  children,
}: {
  name: string;
  desc: string;
  className?: string;
  children: UiNode;
}): UiNode {
  return (
    <div className={`setting-item ${className}`.trim()}>
      <div className="setting-item-info">
        <div className="setting-item-name">{name}</div>
        <div className="setting-item-description">{desc}</div>
      </div>
      <div className="setting-item-control">{children}</div>
    </div>
  );
}
