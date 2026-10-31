"use client";

// Character selection with live 3D preview. One model is mounted at a time
// (lighter than five simultaneous canvases) with thumbnail chips to switch.
import dynamic from "next/dynamic";
import { CHARACTERS, getCharacter, type CharacterId } from "@/lib/characters";
import { CharacterIcon } from "./character-chip";
import { cn } from "@/lib/utils";
import { sounds } from "@/lib/sounds";
import { Badge } from "@/components/ui/badge";

const CharacterStage = dynamic(() => import("./character-stage"), {
  ssr: false,
  loading: () => <div className="h-56 sm:h-72" />,
});

export function CharacterPicker({
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  value: CharacterId;
  onChange: (id: CharacterId) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const selected = getCharacter(value);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.1fr] gap-4 items-stretch">
        <div className="relative bg-lav/60 border-2 border-ink rounded-xl overflow-hidden">
          <CharacterStage
            key={selected.id}
            characters={[{ id: selected.id, scale: 1.05 }]}
            className={compact ? "h-56" : "h-56 sm:h-72"}
            cameraZ={2.2}
          />
          <span className="absolute top-2 left-2 nb-chip bg-card">
            3D preview
          </span>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="font-display font-bold text-2xl uppercase tracking-tight">
              {selected.name}
            </h3>
            <p className="text-sm text-muted-foreground font-medium leading-snug">
              {selected.personality}
            </p>
          </div>
          <div className="border-2 border-ink rounded-lg bg-card p-3 shadow-nb-sm">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="ink">{selected.title}</Badge>
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Once per match
              </span>
            </div>
            <p className="text-sm font-medium mt-2 leading-snug">
              {selected.ability.description}
            </p>
          </div>
        </div>
      </div>

      <div role="radiogroup" aria-label="Choose your character" className="grid grid-cols-5 gap-2">
        {CHARACTERS.map((c) => {
          const active = c.id === value;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => {
                if (c.id !== value) sounds.play("select");
                onChange(c.id);
              }}
              className={cn(
                "nb-press flex flex-col items-center gap-1.5 border-2 border-ink rounded-lg py-2.5 px-1",
                active ? "bg-ink text-paper shadow-nb" : "bg-card shadow-nb-sm",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <CharacterIcon characterId={c.id} className={active ? "ring-2 ring-paper" : undefined} />
              <span className={cn("text-[10px] font-bold uppercase tracking-wide leading-tight", active ? "text-paper" : "text-foreground")}>
                {c.name.replace("The ", "")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
