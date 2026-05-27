import { setIcon } from "obsidian";
import { useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

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
}

export function IconButton({ icon, label, className, children, ...props }: IconButtonProps): ReactNode {
  const ref = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const button = ref.current;
    if (!button || children) return;
    button.replaceChildren();
    setIcon(button, icon);
  }, [children, icon]);
  return (
    <button {...props} ref={ref} className={className} aria-label={label} type={props.type ?? "button"}>
      {children ? <ObsidianIcon icon={icon} /> : null}
      {children}
    </button>
  );
}
