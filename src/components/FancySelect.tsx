import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

export type FancySelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type FancySelectProps = {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  emptyMessage?: string;
  onChange: (nextValue: string) => void;
  options: FancySelectOption[];
  placeholder?: string;
  value: string;
};

function FancySelect({
  ariaLabel,
  className,
  disabled = false,
  emptyMessage = "",
  onChange,
  options,
  placeholder = "",
  value,
}: FancySelectProps) {
  const { t, tp } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? null;
  const selectedLabel = selected ? tp(selected.label) : tp(placeholder || t("fancy.placeholder"));
  const isGraphFileSelect = (className ?? "").includes("graph-file-select");

  useEffect(() => {
    const onWindowMouseDown = (event: MouseEvent) => {
      if (!rootRef.current) {
        return;
      }
      if (!rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("mousedown", onWindowMouseDown);
    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("mousedown", onWindowMouseDown);
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const root = rootRef.current;
    const menu = menuRef.current;
    if (!root || !menu) {
      return;
    }

    const container = root.closest(".inspector-content, .childview-view");
    if (!(container instanceof HTMLElement)) {
      return;
    }

    const minBottomGap = 16;
    const previousGap = container.style.getPropertyValue("--dropdown-open-gap");
    const requiredGap = 160;
    container.style.setProperty("--dropdown-open-gap", `${requiredGap}px`);

    const frame = window.requestAnimationFrame(() => {
      const menuRect = menu.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const overflow = menuRect.bottom + minBottomGap - containerRect.bottom;
      if (overflow <= 0) {
        return;
      }
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTop = Math.min(maxScrollTop, container.scrollTop + overflow);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (previousGap) {
        container.style.setProperty("--dropdown-open-gap", previousGap);
      } else {
        container.style.removeProperty("--dropdown-open-gap");
      }
    };
  }, [isOpen]);

  return (
    <div className={`fancy-select ${className ?? ""} ${isOpen ? "is-open" : ""}`} ref={rootRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="fancy-select-trigger"
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          setIsOpen((prev) => !prev);
        }}
        type="button"
      >
        <span className={`fancy-select-value ${selected ? "" : "is-placeholder"}`}>
          {selectedLabel}
        </span>
        <span aria-hidden="true" className="fancy-select-chevron">
          <img
            alt=""
            className="fancy-select-chevron-icon"
            src={isOpen ? "/up-arrow.svg" : "/down-arrow.svg"}
          />
        </span>
      </button>
      {isOpen && (
        <div className="fancy-select-menu" ref={menuRef} role="listbox">
          {options.length === 0 && (
            <div
              className="fancy-select-empty"
              style={
                isGraphFileSelect
                  ? { minHeight: "36px", height: "36px", display: "flex", alignItems: "center", padding: "0 11px" }
                  : undefined
              }
            >
              {tp(emptyMessage || t("fancy.empty"))}
            </div>
          )}
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className={`fancy-select-option ${option.value === value ? "is-selected" : ""}`}
              disabled={option.disabled}
              key={option.value}
              onClick={() => {
                if (option.disabled) {
                  return;
                }
                onChange(option.value);
                setIsOpen(false);
              }}
              role="option"
              type="button"
            >
              <span className="fancy-select-option-label">{tp(option.label)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default FancySelect;
