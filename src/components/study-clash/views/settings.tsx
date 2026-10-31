"use client";

// Settings: sound effects, default character, account info, sign out.
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { CharacterPicker } from "../parts/character-picker";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { api } from "../api";
import { useSoundPrefs, sounds } from "@/lib/sounds";
import type { CharacterId } from "@/lib/characters";
import { Loader2, Save, LogOut, ShieldCheck, Volume2, Play } from "lucide-react";
import { useSession } from "next-auth/react";

export default function SettingsView() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const sound = useSoundPrefs();
  const [characterId, setCharacterId] = useState<CharacterId>(
    (session?.user as { characterId?: CharacterId } | undefined)?.characterId ?? "thinker"
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);

  const initial = (session?.user as { characterId?: CharacterId } | undefined)?.characterId ?? "thinker";
  useEffect(() => {
    setSaved(characterId === initial);
  }, [characterId, initial]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ characterId }),
      });
      setSaved(true);
      toast({
        title: "Default character saved",
        description: "New matches will start with this character preselected.",
      });
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto">
      <div>
        <h1 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">Settings</h1>
        <p className="text-muted-foreground font-medium mt-1">
          Your default character and account controls.
        </p>
      </div>

      <div className="nb-card p-5 sm:p-6">
        <h2 className="font-display font-bold text-lg uppercase tracking-wide mb-1 flex items-center gap-2">
          <Volume2 className="size-5" /> Sound effects
        </h2>
        <p className="text-sm text-muted-foreground font-medium mb-5">
          Game feedback sounds — countdown ticks, correct/wrong chimes, victory
          fanfares and more. Quick toggle any time from the header.
        </p>
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-bold text-sm">Enable sound effects</p>
              <p className="text-xs text-muted-foreground font-medium">
                {sound.muted ? "Muted — the arena is silent." : "On — full game-show energy."}
              </p>
            </div>
            <Switch
              checked={!sound.muted}
              onCheckedChange={(v) => sound.setMuted(!v)}
              aria-label="Toggle sound effects"
            />
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground w-16 shrink-0">
              Volume
            </span>
            <Slider
              value={[Math.round(sound.volume * 100)]}
              min={0}
              max={100}
              step={5}
              onValueChange={([v]) => sound.setVolume(v / 100)}
              disabled={sound.muted}
              aria-label="Sound volume"
              className="flex-1"
            />
            <span className="text-xs font-bold tabular-nums w-10 text-right">
              {Math.round(sound.volume * 100)}%
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => sounds.play("correct")}
              disabled={sound.muted}
            >
              <Play className="size-3.5" /> Correct
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => sounds.play("victory")}
              disabled={sound.muted}
            >
              <Play className="size-3.5" /> Victory
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => sounds.play("countdown")}
              disabled={sound.muted}
            >
              <Play className="size-3.5" /> Countdown
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => sounds.play("ability")}
              disabled={sound.muted}
            >
              <Play className="size-3.5" /> Ability
            </Button>
          </div>
        </div>
      </div>

      <div className="nb-card p-5 sm:p-6">
        <h2 className="font-display font-bold text-lg uppercase tracking-wide mb-1">
          Default character
        </h2>
        <p className="text-sm text-muted-foreground font-medium mb-5">
          Preselected in Clash and Practice setup. You can still switch per
          match.
        </p>
        <CharacterPicker value={characterId} onChange={setCharacterId} />
        <div className="flex items-center gap-3 mt-5">
          <Button onClick={() => void handleSave()} disabled={saving || saved} size="lg">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {saved ? "Saved" : "Save default"}
          </Button>
          {!saved && (
            <p className="text-xs font-bold text-coral uppercase tracking-wider">Unsaved changes</p>
          )}
        </div>
      </div>

      <div className="nb-card p-5 sm:p-6">
        <h2 className="font-display font-bold text-lg uppercase tracking-wide mb-1">Account</h2>
        <div className="flex items-center gap-3 mt-4">
          <span className="nb-chip bg-lav text-ink text-sm normal-case tracking-normal py-1.5 px-3">
            @{session?.user?.name ?? "player"}
          </span>
          <Button variant="destructive" size="lg" onClick={() => void signOut({ callbackUrl: "/" })}>
            <LogOut className="size-4" /> Log out
          </Button>
        </div>
      </div>

      <div className="nb-card p-5 sm:p-6 bg-ink text-paper border-ink">
        <h2 className="font-display font-bold text-lg uppercase tracking-wide mb-2 flex items-center gap-2">
          <ShieldCheck className="size-5 text-mint" /> Fair play guarantees
        </h2>
        <ul className="text-sm font-medium text-paper/80 list-disc pl-5 leading-relaxed">
          <li>Answer keys are computed and stored server-side only.</li>
          <li>Correct answers reach your browser only after a round locks.</li>
          <li>Scores, timers and abilities are validated by the game server.</li>
          <li>Documents are private — opponents never see your material.</li>
        </ul>
      </div>
    </div>
  );
}
