import type { Setting, SettingGroup } from "obsidian";

// Obsidian 1.13 declarative settings subset used while the plugin continues to
// compile against its 1.12 runtime baseline. Remove this compatibility surface
// when minAppVersion and the obsidian type package move to 1.13 or later.
interface DeclarativeSettingBase {
  name: string;
  desc?: string | DocumentFragment;
  aliases?: string[];
  searchable?: boolean | (() => boolean);
  visible?: boolean | (() => boolean);
}

type DeclarativeSettingControl =
  | { type: "toggle"; key: string; defaultValue?: boolean; disabled?: boolean | (() => boolean) }
  | {
      type: "dropdown";
      key: string;
      defaultValue?: string;
      options: Record<string, string>;
      disabled?: boolean | (() => boolean);
    };

export type DeclarativeSettingDefinition = DeclarativeSettingBase &
  (
    | { control: DeclarativeSettingControl; render?: never; action?: never }
    | { render: (setting: Setting, group: SettingGroup) => undefined | (() => void); control?: never; action?: never }
    | { control?: never; render?: never; action?: never }
  );

interface DeclarativeSettingGroup {
  type: "group";
  heading?: string;
  cls?: string;
  items?: DeclarativeSettingDefinition[];
  visible?: boolean | (() => boolean);
}

export type DeclarativeSettingDefinitionItem = DeclarativeSettingDefinition | DeclarativeSettingGroup;
