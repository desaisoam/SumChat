"use client";

import { forwardRef, useEffect } from "react";
import type { ButtonHTMLAttributes } from "react";

type Variant = "default" | "outline" | "ghost";
type Size = "default" | "sm" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const styles = `
.nc-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border-radius: 9999px;
  border: 1px solid transparent;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.18s ease;
  transform: translateZ(0);
  white-space: nowrap;
  user-select: none;
  text-decoration: none;
}
.nc-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.35);
}
.nc-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  box-shadow: none;
}
.nc-btn--default {
  background: #111827;
  color: #F9FAFB;
  box-shadow: 0 8px 18px -10px rgba(15, 23, 42, 0.55);
}
.nc-btn--default:hover:not(:disabled) {
  background: #0F172A;
}
.nc-btn--outline {
  background: #FFFFFF;
  color: #111827;
  border-color: rgba(99, 102, 241, 0.3);
}
.nc-btn--outline:hover:not(:disabled) {
  background: #F3F4F6;
}
.nc-btn--ghost {
  background: transparent;
  color: #1F2937;
}
.nc-btn--ghost:hover:not(:disabled) {
  background: rgba(17, 24, 39, 0.06);
}
.nc-btn--default:active:not(:disabled),
.nc-btn--outline:active:not(:disabled),
.nc-btn--ghost:active:not(:disabled) {
  transform: translateY(1px);
}
.nc-btn__size-default {
  padding: 0.55rem 1.1rem;
  font-size: 0.95rem;
  min-height: 2.5rem;
}
.nc-btn__size-sm {
  padding: 0.4rem 0.85rem;
  font-size: 0.85rem;
  min-height: 2.1rem;
}
.nc-btn__size-lg {
  padding: 0.7rem 1.45rem;
  font-size: 1rem;
  min-height: 2.9rem;
}
`;

let injected = false;
const ensureStyles = () => {
  if (injected || typeof document === "undefined") return;
  const tag = document.createElement("style");
  tag.setAttribute("data-nc-ui", "button");
  tag.textContent = styles;
  document.head.appendChild(tag);
  injected = true;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "default", className = "", ...props },
  ref,
) {
  useEffect(() => {
    ensureStyles();
  }, []);

  const classes = ["nc-btn", `nc-btn--${variant}`, `nc-btn__size-${size}`, className]
    .filter(Boolean)
    .join(" ");

  return <button ref={ref} className={classes} {...props} />;
});
