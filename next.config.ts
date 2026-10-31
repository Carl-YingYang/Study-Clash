import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // pdf-parse (and its bundled pdfjs-dist) must stay external so the
  // pdf.js fake-worker can resolve pdf.worker.mjs from node_modules at
  // runtime instead of through the bundler.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
