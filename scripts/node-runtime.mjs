import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
export async function projectNode(root) {
  const pin = readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
  if (!/^24\.\d+\.\d+$/.test(pin)) throw new Error("The project needs a valid supported Node 24 pin in .nvmrc.");
  if (process.versions.node === pin) return process.execPath;
  const candidates = [
    path.join(homedir(), ".nvm", "versions", "node", `v${pin}`, "bin", "node"),
    path.join(root, ".convex", "runtime", `node-v${pin}-${process.platform}-${process.arch}`, "bin", "node"),
  ];
  try {
    const where = execFileSync("mise", ["where", `node@${pin}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    candidates.unshift(path.join(where, "bin", "node"));
  } catch { /* A version manager is optional. The verified fallback is below. */ }
  for (const node of candidates) {
    if (!existsSync(node)) continue;
    try { if (execFileSync(node, ["--version"], { encoding: "utf8" }).trim() === `v${pin}`) return node; } catch { /* Try another installed runtime. */ }
  }
  if (!["linux", "darwin"].includes(process.platform) || !["x64", "arm64"].includes(process.arch))
    throw new Error(`Install Node ${pin} and rerun this command; automatic installation supports Linux/macOS x64/arm64.`);
  const name = `node-v${pin}-${process.platform}-${process.arch}`;
  const cache = path.join(root, ".convex", "runtime");
  await mkdir(cache, { recursive: true });
  const temporary = await mkdtemp(path.join(cache, "download-"));
  try {
    console.log(`Installing the project runtime, Node ${pin}, once from nodejs.org…`);
    const archiveName = `${name}.tar.gz`;
    const base = `https://nodejs.org/dist/v${pin}/`;
    const manifest = await fetch(`${base}SHASUMS256.txt`, { signal: AbortSignal.timeout(30000) });
    if (!manifest.ok) throw new Error("Cannot obtain the official Node checksum manifest.");
    const checksum = (await manifest.text()).split("\n").find(line => line.trim().endsWith(` ${archiveName}`))?.trim().split(/\s+/)[0];
    if (!checksum || !/^[a-f0-9]{64}$/.test(checksum)) throw new Error("Official Node checksum is missing.");
    const response = await fetch(`${base}${archiveName}`, { signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body) throw new Error("Cannot download the supported Node runtime.");
    const archive = path.join(temporary, archiveName);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { mode: 0o600 }));
    if (createHash("sha256").update(await readFile(archive)).digest("hex") !== checksum) throw new Error("Node archive checksum mismatch; installation cancelled.");
    execFileSync("tar", ["-xzf", archive, "-C", temporary]);
    if (!existsSync(path.join(cache, name))) await rename(path.join(temporary, name), path.join(cache, name));
    await writeFile(path.join(cache, `${name}.verified`), `${checksum}\n`);
    return path.join(cache, name, "bin", "node");
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
