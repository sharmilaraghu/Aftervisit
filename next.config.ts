import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The console ends up in a published video; the dev badge sat over the rail
  // footer in every frame.
  devIndicators: false,
};

export default nextConfig;
