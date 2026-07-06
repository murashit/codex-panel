import { ButtonComponent, DropdownComponent, ExtraButtonComponent, setIcon, TextComponent, ToggleComponent } from "obsidian";
import type { ButtonHTMLAttributes, HTMLAttributes, Ref, ComponentChild as UiNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

import { disposeDomListeners, listenDomEvent } from "../dom/events.dom";

interface ObsidianIconProps {
  icon: string;
  className?: string;
}

export interface ObsidianDropdownOption {
  value: string;
  label: string;
}

function useLatestRef<T>(value: T): { current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function ObsidianIcon({ icon, className }: ObsidianIconProps): UiNode {
  const ref = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.replaceChildren();
    setIcon(element, icon);
  }, [icon]);
  return <span ref={ref} className={className} aria-hidden="true" />;
}

export interface IconButtonProps extends ButtonHTMLAttributes {
  icon: string;
  label: string;
  buttonRef?: Ref<HTMLButtonElement>;
  disabled?: boolean | undefined;
  type?: "button" | "submit" | "reset" | undefined;
}

export function IconButton({ icon, label, buttonRef, className, children, ...props }: IconButtonProps): UiNode {
  const ref = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const button = ref.current;
    if (!button || children) return;
    button.replaceChildren();
    setIcon(button, icon);
  }, [children, icon]);
  return (
    <button
      {...props}
      ref={(element) => {
        ref.current = element;
        if (typeof buttonRef === "function") {
          buttonRef(element);
        } else if (buttonRef) {
          buttonRef.current = element;
        }
      }}
      className={className}
      aria-label={label}
      type={props.type ?? "button"}
    >
      {children ? <ObsidianIcon icon={icon} /> : null}
      {children}
    </button>
  );
}

export type ObsidianToolbarActionProps = Omit<HTMLAttributes<HTMLDivElement>, "className"> & {
  icon: string;
  label: string;
  actionRef?: Ref<HTMLDivElement>;
  className?: string | undefined;
  disabled?: boolean | undefined;
};

export function ObsidianToolbarAction({
  icon,
  label,
  actionRef,
  className,
  disabled,
  onClick,
  ...props
}: ObsidianToolbarActionProps): UiNode {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const action = ref.current;
    if (!action) return;
    action.replaceChildren();
    setIcon(action, icon);
  }, [icon]);
  return (
    // biome-ignore lint/a11y: Obsidian core toolbar icons are div.clickable-icon nav-action-button elements with aria-label tooltips, not native buttons.
    <div
      {...props}
      ref={(element) => {
        ref.current = element;
        if (typeof actionRef === "function") {
          actionRef(element);
        } else if (actionRef) {
          actionRef.current = element;
        }
      }}
      className={[className, disabled ? "is-disabled" : ""].filter(Boolean).join(" ")}
      aria-label={label}
      onClick={disabled ? undefined : onClick}
    />
  );
}

export function ObsidianDropdown({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly ObsidianDropdownOption[];
  onChange: (value: string) => void;
}): UiNode {
  const ref = useRef<HTMLSpanElement | null>(null);
  const onChangeRef = useLatestRef(onChange);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.empty();
    const dropdown = new DropdownComponent(container);
    for (const option of options) {
      dropdown.addOption(option.value, option.label);
    }
    dropdown.setValue(value).onChange((selected) => {
      onChangeRef.current(selected);
    });
    return () => {
      container.empty();
    };
  }, [onChangeRef, options, value]);

  return <span ref={ref} />;
}

export function ObsidianCommitTextInput({
  value,
  placeholder,
  normalizeValue,
  onCommit,
}: {
  value: string;
  placeholder: string;
  normalizeValue?: (value: string) => string;
  onCommit: (value: string) => void;
}): UiNode {
  const ref = useRef<HTMLSpanElement | null>(null);
  const normalizeValueRef = useLatestRef(normalizeValue);
  const onCommitRef = useLatestRef(onCommit);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.empty();
    const text = new TextComponent(container);
    text.setPlaceholder(placeholder).setValue(value);
    const commit = () => {
      const committedValue = normalizeValueRef.current?.(text.inputEl.value) ?? text.inputEl.value;
      text.inputEl.value = committedValue;
      onCommitRef.current(committedValue);
    };
    return disposeDomListeners(
      listenDomEvent(text.inputEl, "blur", commit),
      listenDomEvent(text.inputEl, "keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commit();
      }),
      () => {
        container.empty();
      },
    );
  }, [normalizeValueRef, onCommitRef, placeholder, value]);

  return <span ref={ref} />;
}

export function ObsidianToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }): UiNode {
  const ref = useRef<HTMLSpanElement | null>(null);
  const onChangeRef = useLatestRef(onChange);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.empty();
    const toggle = new ToggleComponent(container);
    toggle.setValue(checked).onChange((nextValue) => {
      onChangeRef.current(nextValue);
    });
    return () => {
      container.empty();
    };
  }, [checked, onChangeRef]);

  return <span ref={ref} />;
}

export function ObsidianExtraButton({
  icon,
  label,
  className,
  onClick,
}: {
  icon: string;
  label: string;
  className?: string;
  onClick: () => void;
}): UiNode {
  const ref = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.empty();
    const button = new ExtraButtonComponent(container).setIcon(icon).setTooltip(label).onClick(onClick);
    button.extraSettingsEl.ariaLabel = label;
    const stopPointerDown = (event: PointerEvent): void => {
      event.stopPropagation();
    };
    const disposePointerDown = listenDomEvent(button.extraSettingsEl, "pointerdown", stopPointerDown);
    if (className) {
      for (const classPart of className.split(" ").filter(Boolean)) {
        button.extraSettingsEl.addClass(classPart);
      }
    }
    return disposeDomListeners(disposePointerDown, () => {
      container.empty();
    });
  }, [className, icon, label, onClick]);

  return <span ref={ref} />;
}

export function ObsidianButton({ text, disabled, onClick }: { text: string; disabled?: boolean; onClick: () => void }): UiNode {
  const ref = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.empty();
    const button = new ButtonComponent(container)
      .setButtonText(text)
      .setDisabled(disabled ?? false)
      .onClick(() => {
        onClick();
      });
    button.buttonEl.type = "button";
    return () => {
      container.empty();
    };
  }, [disabled, onClick, text]);

  return <span ref={ref} />;
}
