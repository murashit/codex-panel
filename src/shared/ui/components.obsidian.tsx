import { ButtonComponent, DropdownComponent, ExtraButtonComponent, setIcon, TextComponent, ToggleComponent } from "obsidian";
import type { ButtonHTMLAttributes, Ref, ComponentChild as UiNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

interface ObsidianIconProps {
  icon: string;
  className?: string;
}

export interface ObsidianDropdownOption {
  value: string;
  label: string;
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
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.empty();
    const dropdown = new DropdownComponent(container);
    for (const option of options) {
      dropdown.addOption(option.value, option.label);
    }
    dropdown.setValue(value).onChange((selected) => {
      onChange(selected);
    });
    return () => {
      container.empty();
    };
  }, [onChange, options, value]);

  return <span ref={ref} />;
}

export function ObsidianTextInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}): UiNode {
  const ref = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.empty();
    const text = new TextComponent(container);
    text
      .setPlaceholder(placeholder)
      .setValue(value)
      .onChange((nextValue) => {
        onChange(nextValue);
      });
    return () => {
      container.empty();
    };
  }, [onChange, placeholder, value]);

  return <span ref={ref} />;
}

export function ObsidianToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }): UiNode {
  const ref = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.empty();
    const toggle = new ToggleComponent(container);
    toggle.setValue(checked).onChange((nextValue) => {
      onChange(nextValue);
    });
    return () => {
      container.empty();
    };
  }, [checked, onChange]);

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
    button.extraSettingsEl.addEventListener("pointerdown", stopPointerDown);
    if (className) {
      for (const classPart of className.split(" ").filter(Boolean)) {
        button.extraSettingsEl.addClass(classPart);
      }
    }
    return () => {
      button.extraSettingsEl.removeEventListener("pointerdown", stopPointerDown);
      container.empty();
    };
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
