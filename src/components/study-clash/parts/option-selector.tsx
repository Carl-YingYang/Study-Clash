"use client";

// Shared segmented option selector used across quiz setup screens.
import { cn } from "@/lib/utils";
import { sounds } from "@/lib/sounds";

export interface OptionItem<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
}

export function OptionGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  accent = "bg-brand",
  disabled = false,
  columns = 3,
}: {
  label: string;
  options: OptionItem<T>[];
  value: T;
  onChange: (v: T) => void;
  accent?: string;
  disabled?: boolean;
  columns?: 2 | 3 | 4;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn(
          "grid gap-2",
          columns === 2 && "grid-cols-2",
          columns === 3 && "grid-cols-3",
          columns === 4 && "grid-cols-2 sm:grid-cols-4"
        )}
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => {
                if (opt.value !== value) sounds.play("select");
                onChange(opt.value);
              }}
              className={cn(
                "nb-press border-2 border-ink rounded-lg px-3 py-2.5 text-left transition-colors",
                active ? `${accent} text-ink shadow-nb` : "bg-card text-foreground shadow-nb-sm",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <span className="block font-display font-bold text-sm uppercase tracking-wide">
                {opt.label}
              </span>
              {opt.hint && (
                <span className="block text-[11px] font-medium text-muted-foreground mt-0.5 leading-tight">
                  {opt.hint}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
