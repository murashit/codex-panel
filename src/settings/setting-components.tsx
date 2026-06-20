import type { ComponentChild as UiNode } from "preact";

import {
  ObsidianDropdown,
  type ObsidianDropdownOption,
  ObsidianExtraButton,
  ObsidianTextInput,
  ObsidianToggle,
} from "../shared/ui/components";

export type SelectControlOption = ObsidianDropdownOption;

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
        <div className="setting-item-name">{name}</div>
        <div className="setting-item-description">{desc}</div>
        {extraInfo}
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
  return <ObsidianExtraButton icon={icon} label={label} className={className} onClick={onClick} />;
}

export function SelectControl({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectControlOption[];
}): UiNode {
  return <ObsidianDropdown value={value} options={options} onChange={onChange} />;
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
  return <ObsidianTextInput value={value} placeholder={placeholder} onChange={onChange} />;
}

export function ToggleControl({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }): UiNode {
  return <ObsidianToggle checked={checked} onChange={onChange} />;
}
