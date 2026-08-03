import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root. Without this, Next walks up looking for a lockfile,
  // finds one in the user's home directory, and infers a root far outside the
  // project. Harmless in dev, but on Vercel a wrong root changes which files get
  // traced into the deployment.
  turbopack: {
    root: __dirname,
  },
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
