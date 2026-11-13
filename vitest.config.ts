import { defineConfig } from "vitest/config";
import wasmModule from "vite-plugin-wasm-module";
export default defineConfig({
  resolve: { alias: { "@": new URL(".", import.meta.url).pathname } },
  plugins: [wasmModule()],
  test: { environment: "edge-runtime", include: ["tests/**/*.test.ts"], env: { CONVEX_CLOUD_URL: "https://guildzero-test.convex.cloud" }, server: { deps: { inline: ["convex-test", "password-hash-wasm"] } } },
});
