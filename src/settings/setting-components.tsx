import type { ComponentChild as UiNode, TargetedMouseEvent, TargetedPointerEvent } from "preact";

import { IconButton } from "../shared/ui/components";

export function SettingsHeading({ name, desc, dynamic = false }: { name: string; desc?: string; dynamic?: boolean }): UiNode {
  return (
    <div
      className={`${dynamic ? "codex-panel-settings__dynamic-section-heading" : "codex-panel-settings__section-heading"} setting-item setting-item-heading`}
    >
      <div className="setting-item-info">
        <div className="setting-item-description">
          <div className="setting-item-name">{name}</div>
          {desc ?? null}
        </div>
      </div>
      <div className="setting-item-control" />
    </div>
  );
}

export function SettingRow({
  name,
  desc,
  className = "",
  extraInfo,
  children,
}: {
  name: string;
  desc: string;
  className?: string;
  extraInfo?: UiNode;
  children: UiNode;
}): UiNode {
  return (
    <div className={`setting-item ${className}`.trim()}>
      <div className="setting-item-info">
        <div className="setting-item-description">
          <div className="setting-item-name">{name}</div>
          {desc}
          {extraInfo}
        </div>
      </div>
      <div className="setting-item-control">{children}</div>
    </div>
  );
}

export function SettingsIconButton({
  icon,
  label,
  className,
  onClick,
}: {
  icon: string;
  label: string;
  className: string;
  onClick: () => void;
}): UiNode {
  return (
    <IconButton
      icon={icon}
      label={label}
      className={`clickable-icon extra-setting-button ${className}`}
      onPointerDown={(event: TargetedPointerEvent<HTMLButtonElement>) => {
        event.stopPropagation();
      }}
      onClick={(event: TargetedMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    />
  );
}

export function SelectControl({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: UiNode;
}): UiNode {
  return (
    <select
      className="dropdown"
      value={value}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
    >
      {children}
    </select>
  );
}

export function TextControl({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}): UiNode {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
    />
  );
}

export function ToggleControl({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }): UiNode {
  return (
    <div
      className={`checkbox-container ${checked ? "is-enabled" : ""}`}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        onChange(!checked);
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
      />
    </div>
  );
}
