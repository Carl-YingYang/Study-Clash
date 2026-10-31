"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouterStore } from "../stores";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, LogIn, UserPlus, Swords } from "lucide-react";

export default function AuthView() {
  const go = useRouterStore((s) => s.go);
  const params = useRouterStore((s) => s.params);
  const { toast } = useToast();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const afterAuth = () => {
    if (params.joinCode) {
      go("clash", { joinCode: params.joinCode });
    } else {
      go("dashboard");
    }
  };

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    try {
      const res = await signIn("credentials", {
        username: username.trim().toLowerCase(),
        password,
        redirect: false,
      });
      if (res?.error) {
        toast({
          title: "Login failed",
          description: "Wrong username or password.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Welcome back", description: "Logged in successfully." });
        afterAuth();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    if (password !== confirm) {
      toast({ title: "Check your password", description: "The two passwords don't match.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      });
      const res = await signIn("credentials", {
        username: username.trim().toLowerCase(),
        password,
        redirect: false,
      });
      if (res?.error) throw new Error("Auto-login failed — please log in.");
      toast({ title: "Account created", description: "Welcome to Study Clash." });
      afterAuth();
    } catch (err) {
      toast({
        title: "Registration failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 nb-grid-bg flex items-center justify-center px-4 py-14">
      <div className="w-full max-w-md">
        {params.joinCode && (
          <div className="nb-card p-4 mb-4 bg-mint flex items-center gap-3">
            <Swords className="size-5 shrink-0" />
            <p className="text-sm font-bold">
              You were invited to clash in room{" "}
              <span className="font-display tracking-widest">{params.joinCode}</span>.
              Sign in or create an account to join.
            </p>
          </div>
        )}
        <div className="nb-card p-6">
          <div className="mb-6 text-center">
            { }
            <img src="/sc-logo.svg" alt="" className="size-14 mx-auto rounded-xl border-2 border-ink shadow-nb-sm" />
            <h1 className="font-display font-bold text-2xl uppercase tracking-tight mt-4">
              Enter the arena
            </h1>
            <p className="text-sm text-muted-foreground font-medium mt-1">
              One account. All your clashes, stats and rankings.
            </p>
          </div>

          <Tabs value={mode} onValueChange={(v) => setMode(v as "login" | "register")}>
            <TabsList className="grid grid-cols-2 w-full mb-5 bg-muted border-2 border-ink rounded-lg h-11">
              <TabsTrigger value="login" className="font-bold rounded-md">
                Log in
              </TabsTrigger>
              <TabsTrigger value="register" className="font-bold rounded-md">
                Sign up
              </TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="login-username" className="font-bold text-sm">Username</Label>
                  <Input
                    id="login-username"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="study_master"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="login-password" className="font-bold text-sm">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
                <Button type="submit" size="lg" disabled={busy} className="mt-1">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                  Log in
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="register">
              <form onSubmit={handleRegister} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reg-username" className="font-bold text-sm">Username</Label>
                  <Input
                    id="reg-username"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="3-20 chars: a-z, 0-9, _"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reg-password" className="font-bold text-sm">Password</Label>
                  <Input
                    id="reg-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reg-confirm" className="font-bold text-sm">Confirm password</Label>
                  <Input
                    id="reg-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat your password"
                    required
                  />
                </div>
                <Button type="submit" size="lg" disabled={busy} className="mt-1">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                  Create account
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <button
            onClick={() => go("landing")}
            className="mt-5 w-full text-center text-sm font-bold text-muted-foreground hover:text-foreground"
          >
            ← Back to home
          </button>
        </div>
      </div>
    </div>
  );
}
