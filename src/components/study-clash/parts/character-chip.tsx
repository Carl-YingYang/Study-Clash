"use client";

// 2D character identity chip (used in lists, leaderboards, HUDs).
import { Brain, GraduationCap, Zap, Dices, Sparkles, type LucideIcon } from "lucide-react";
import { getCharacter } from "@/lib/characters";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  brain: Brain,
  "graduation-cap": GraduationCap,
  zap: Zap,
  dices: Dices,
  sparkles: Sparkles,
};

export function CharacterIcon({
  characterId,
  className,
  iconClassName,
}: {
  characterId: string;
  className?: string;
  iconClassName?: string;
}) {
  const char = getCharacter(characterId);
  const Icon = ICONS[char.icon] ?? Brain;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex items-center justify-center size-8 rounded-lg border-2 border-ink shrink-0",
        className
      )}
      style={{ backgroundColor: char.color }}
    >
      <Icon className={cn("size-4 text-ink", iconClassName)} strokeWidth={2.5} />
    </span>
  );
}

export function CharacterChip({
  characterId,
  showName = true,
  className,
}: {
  characterId: string;
  showName?: boolean;
  className?: string;
}) {
  const char = getCharacter(characterId);
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <CharacterIcon characterId={characterId} />
      {showName && (
        <span className="text-sm font-bold font-display tracking-wide uppercase">
          {char.name}
        </span>
      )}
    </span>
  );
}
