import type { NextConfig } from "next";

console.log("[next.config] __dirname =", __dirname, "| cwd =", process.cwd());

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
