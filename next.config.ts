import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.LOCAL_TEST_DIST_DIR || ".next",
  turbopack: { root: process.cwd() },
};
export default config;
