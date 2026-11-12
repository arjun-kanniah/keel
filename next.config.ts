import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone", // the Docker image runs .next/standalone/server.js
  // Help pages and migrations are read from disk at runtime
  outputFileTracingIncludes: { "/**": ["./help/**/*.md"] },
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
};

export default config;
