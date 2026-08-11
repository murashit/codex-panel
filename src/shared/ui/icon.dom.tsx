import {
  type ButtonHTMLAttributes,
  type ComponentChildren,
  createContext,
  type HTMLAttributes,
  type Ref,
  type ComponentChild as UiNode,
} from "preact";
import { useContext, useLayoutEffect, useRef } from "preact/hooks";

export type IconRenderer = (element: HTMLElement, icon: string) => void;

const IconRendererContext = createContext<IconRenderer | null>(null);

export function IconRendererProvider({ renderer, children }: { renderer: IconRenderer; children: ComponentChildren }): UiNode {
  return <IconRendererContext.Provider value={renderer}>{children}</IconRendererContext.Provider>;
}

export type IconProps = Omit<HTMLAttributes<HTMLSpanElement>, "icon"> & {
  icon: string;
};

export function Icon({ icon, ...props }: IconProps): UiNode {
  const ref = useRef<HTMLSpanElement | null>(null);
  useRenderedIcon(ref, icon, true);
  return <span {...props} ref={ref} aria-hidden="true" />;
}

export interface IconButtonProps extends ButtonHTMLAttributes {
  icon: string;
  label: string;
  buttonRef?: Ref<HTMLButtonElement> | undefined;
  disabled?: boolean | undefined;
  type?: "button" | "submit" | "reset" | undefined;
}

export function IconButton({ icon, label, buttonRef, className, children, ...props }: IconButtonProps): UiNode {
  const ref = useRef<HTMLButtonElement | null>(null);
  useRenderedIcon(ref, icon, !children);
  return (
    <button
      {...props}
      ref={(element) => {
        ref.current = element;
        assignRef(buttonRef, element);
      }}
      className={className}
      aria-label={label}
      type={props.type ?? "button"}
    >
      {children ? <Icon icon={icon} /> : null}
      {children}
    </button>
  );
}

export type ToolbarIconActionProps = Omit<HTMLAttributes<HTMLDivElement>, "className"> & {
  icon: string;
  label: string;
  actionRef?: Ref<HTMLDivElement> | undefined;
  className?: string | undefined;
  disabled?: boolean | undefined;
};

export function ToolbarIconAction({ icon, label, actionRef, className, disabled, onClick, ...props }: ToolbarIconActionProps): UiNode {
  const ref = useRef<HTMLDivElement | null>(null);
  useRenderedIcon(ref, icon, true);
  return (
    // biome-ignore lint/a11y: Obsidian-style toolbar actions are pointer-first div elements with aria-label tooltips.
    <div
      {...props}
      ref={(element) => {
        ref.current = element;
        assignRef(actionRef, element);
      }}
      className={[className, disabled ? "is-disabled" : ""].filter(Boolean).join(" ")}
      aria-label={label}
      onClick={disabled ? undefined : onClick}
    />
  );
}

function useRenderedIcon(ref: { readonly current: HTMLElement | null }, icon: string, enabled: boolean): void {
  const renderer = useContext(IconRendererContext);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the ref object is stable; icon and renderer changes drive repainting its current element.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    element.replaceChildren();
    element.dataset["icon"] = icon;
    renderer?.(element, icon);
  }, [enabled, icon, renderer]);
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}
