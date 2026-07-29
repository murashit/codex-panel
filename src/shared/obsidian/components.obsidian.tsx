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
  const optionsRef = useLatestRef(options);
  const dropdownRef = useRef<DropdownComponent | null>(null);
  const optionsKey = options.map((option) => `${option.value}\u0000${option.label}`).join("\u0001");
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const dropdown = new DropdownComponent(container);
    dropdownRef.current = dropdown;
    dropdown.onChange((selected) => {
      onChangeRef.current(selected);
    });
    return () => {
      dropdownRef.current = null;
      container.empty();
    };
  }, [onChangeRef]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the latest ref lets option identity stay stable while the semantic key controls reconstruction.
  useLayoutEffect(() => {
    const dropdown = dropdownRef.current;
    if (!dropdown) return;
    dropdown.selectEl.replaceChildren();
    for (const option of optionsRef.current) dropdown.addOption(option.value, option.label);
  }, [optionsKey]);
  useLayoutEffect(() => {
    dropdownRef.current?.setValue(value);
  }, [value]);

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
  const textRef = useRef<TextComponent | null>(null);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const text = new TextComponent(container);
    textRef.current = text;
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
        textRef.current = null;
        container.empty();
      },
    );
  }, [normalizeValueRef, onCommitRef]);
  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;
    text.setPlaceholder(placeholder);
    if (text.inputEl !== text.inputEl.ownerDocument.activeElement) text.setValue(value);
  }, [placeholder, value]);

  return <span ref={ref} />;
}

export function ObsidianToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }): UiNode {
  const ref = useRef<HTMLSpanElement | null>(null);
  const onChangeRef = useLatestRef(onChange);
  const toggleRef = useRef<ToggleComponent | null>(null);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const toggle = new ToggleComponent(container);
    toggleRef.current = toggle;
    toggle.onChange((nextValue) => {
      onChangeRef.current(nextValue);
    });
    return () => {
      toggleRef.current = null;
      container.empty();
    };
  }, [onChangeRef]);
  useLayoutEffect(() => {
    toggleRef.current?.setValue(checked);
  }, [checked]);

  return <span ref={ref} />;
}

export function ObsidianExtraButton({
  icon,
  label,
  className,
  disabled = false,
  onClick,
}: {
  icon: string;
  label: string;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}): UiNode {
  const ref = useRef<HTMLSpanElement | null>(null);
  const onClickRef = useLatestRef(onClick);
  const buttonRef = useRef<ExtraButtonComponent | null>(null);
  const classPartsRef = useRef<string[]>([]);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const button = new ExtraButtonComponent(container).onClick(() => {
      onClickRef.current();
    });
    buttonRef.current = button;
    const stopPointerDown = (event: PointerEvent): void => {
      event.stopPropagation();
    };
    const disposePointerDown = listenDomEvent(button.extraSettingsEl, "pointerdown", stopPointerDown);
    return disposeDomListeners(disposePointerDown, () => {
      buttonRef.current = null;
      container.empty();
    });
  }, [onClickRef]);
  useLayoutEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    button.setIcon(icon).setTooltip(label);
    button.extraSettingsEl.ariaLabel = label;
    for (const classPart of classPartsRef.current) button.extraSettingsEl.classList.remove(classPart);
    const classParts = className?.split(" ").filter(Boolean) ?? [];
    for (const classPart of classParts) button.extraSettingsEl.classList.add(classPart);
    classPartsRef.current = classParts;
  }, [className, icon, label]);
  useLayoutEffect(() => {
    buttonRef.current?.setDisabled(disabled);
  }, [disabled]);

  return <span ref={ref} />;
}

export function ObsidianButton({ text, disabled, onClick }: { text: string; disabled?: boolean; onClick: () => void }): UiNode {
  const ref = useRef<HTMLSpanElement | null>(null);
  const onClickRef = useLatestRef(onClick);
  const buttonRef = useRef<ButtonComponent | null>(null);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const button = new ButtonComponent(container).onClick(() => {
      onClickRef.current();
    });
    buttonRef.current = button;
    button.buttonEl.type = "button";
    return () => {
      buttonRef.current = null;
      container.empty();
    };
  }, [onClickRef]);
  useLayoutEffect(() => {
    buttonRef.current?.setButtonText(text).setDisabled(disabled ?? false);
  }, [disabled, text]);

  return <span ref={ref} />;
}
