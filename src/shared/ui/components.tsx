import { setIcon } from "obsidian";
import type { ButtonHTMLAttributes, ComponentChild as UiNode, Ref } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

export interface ObsidianIconProps {
  icon: string;
  className?: string;
}

export function ObsidianIcon({ icon, className }: ObsidianIconProps): UiNode {
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
