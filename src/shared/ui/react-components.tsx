import { setIcon } from "obsidian";
import { useLayoutEffect, useRef, type ButtonHTMLAttributes, type MutableRefObject, type ReactNode, type Ref } from "react";

export interface ObsidianIconProps {
  icon: string;
  className?: string;
}

export function ObsidianIcon({ icon, className }: ObsidianIconProps): ReactNode {
  const ref = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.replaceChildren();
    setIcon(element, icon);
  }, [icon]);
  return <span ref={ref} className={className} aria-hidden="true" />;
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  label: string;
  buttonRef?: Ref<HTMLButtonElement>;
}

export function IconButton({ icon, label, buttonRef, className, children, ...props }: IconButtonProps): ReactNode {
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
          (buttonRef as MutableRefObject<HTMLButtonElement | null>).current = element;
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
