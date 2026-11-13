import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectNode } from "./node-runtime.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const backendOnly = args[0] === "--backend";
const frontendOnly = args[0] === "--frontend";
const extra = backendOnly || frontendOnly ? args.slice(1) : args;
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGINT");
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
try {
  const node = await projectNode(root);
  const env = { ...process.env, PATH: `${path.dirname(node)}${path.delimiter}${process.env.PATH ?? ""}` };
  const convex = path.join(root, "node_modules", "convex", "bin", "main.js");
  const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(convex) || !existsSync(next)) throw new Error("Dependencies are missing. Run npm ci first.");
  console.log(`GuildZero: using project Node ${readFileSync(path.join(root, ".nvmrc"), "utf8").trim()}.`);
  function launch(bin, flags, supervised = true) {
    const child = spawn(node, [bin, ...flags], { cwd: root, env, stdio: "inherit" });
    children.add(child);
    child.once("error", () => { console.error("A development process could not start."); stop(1); });
    child.once("exit", code => { children.delete(child); if (supervised && !stopping) stop(code ?? 1); });
    return child;
  }
  async function complete(child) { return await new Promise((resolve, reject) => { child.once("exit", code => code === 0 ? resolve() : reject(new Error("Convex setup failed. Fix the backend error above before starting the frontend."))); child.once("error", reject); }); }
  if (backendOnly) launch(convex, ["dev", ...extra]);
  else if (frontendOnly) launch(next, ["dev", ...extra]);
  else {
    if (existsSync(path.join(root, ".env.local"))) process.loadEnvFile(path.join(root, ".env.local"));
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    let reuse = false;
    if (url && /^(?:http:\/\/(?:127\.0\.0\.1|localhost):\d+)/.test(url)) {
      try {
        const response = await fetch(`${url}/api/mutation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "auth:refreshSession", args: { refreshToken: "guildzero-startup-check" }, format: "json" }), signal: AbortSignal.timeout(1500) });
        const result = await response.json();
        reuse = result.status === "success" && result.value?.kind === "noSession";
      } catch { /* Not running: bootstrap the actual configured deployment. */ }
    }
    if (!reuse) {
      await complete(launch(convex, ["dev", "--once"], false));
      if (stopping) throw new Error("Startup cancelled.");
      launch(convex, ["dev"]);
    } else console.log("Using the existing local Convex backend.");
    launch(next, ["dev", ...extra]);
    console.log("Starting Next.js and Convex together. Ctrl+C stops processes started by this command.");
  }
} catch (error) { console.error(error instanceof Error ? error.message : "Development startup failed."); stop(1); }
