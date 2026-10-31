import type { Metadata, Viewport } from "next";
import { Geist, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import Providers from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "700",
});

export const metadata: Metadata = {
  title: "Study Clash — Upload your lessons. Challenge your friends.",
  description:
    "AI-powered competitive quiz platform. Turn PDFs, slides and docs into multiplayer clashes, practice vs AI opponents, and climb the leaderboards.",
  keywords: ["study clash", "quiz", "multiplayer", "AI", "learning game"],
  icons: {
    icon: "/sc-logo.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${display.variable} font-sans antialiased bg-background text-foreground min-h-screen flex flex-col`}
      >
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
