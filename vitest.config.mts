import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests cover lib/** only: the pure, safety-bearing logic. Pages and components
// are verified by looking at them, not by asserting on markup.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
