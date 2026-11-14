import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";

export type AdapterConfig = Readonly<{ gateway: URL; token: string }>;
const tokenPattern = /^[A-Za-z0-9._~-]{32,512}$/;
export class ConfigurationError extends Error {
  constructor() { super("MCP configuration is invalid; check the trusted backend origin and private credential configuration."); }
}
export function trustedBackendOrigin(value: string | undefined): URL {
  try {
    if (!value) throw new ConfigurationError();
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) throw new ConfigurationError();
    return url;
  } catch { throw new ConfigurationError(); }
}
export async function loadAdapterConfig(environment: Readonly<Record<string, string | undefined>> = process.env): Promise<AdapterConfig> {
  const origin = trustedBackendOrigin(environment.GUILDZERO_MCP_BACKEND_ORIGIN);
  const file = environment.GUILDZERO_MCP_TOKEN_FILE;
  const inline = environment.GUILDZERO_MCP_TOKEN;
  if (!!file === !!inline) throw new ConfigurationError();
  let token: string;
  if (file) {
    if (!isAbsolute(file)) throw new ConfigurationError();
    try {
      const metadata = await lstat(file);
      if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600 || (process.getuid && metadata.uid !== process.getuid()) || metadata.size > 1024) throw new ConfigurationError();
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat();
        if (opened.ino !== metadata.ino || opened.dev !== metadata.dev || opened.size > 1024 || !opened.isFile() || (process.getuid && opened.uid !== process.getuid()) || (opened.mode & 0o777) !== 0o600) throw new ConfigurationError();
        const buffer = Buffer.alloc(1025);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 1024) throw new ConfigurationError();
        token = buffer.subarray(0, bytesRead).toString("utf8").replace(/\r?\n$/, "");
      } finally { await handle.close(); }
    } catch { throw new ConfigurationError(); }
  } else token = inline!;
  if (!tokenPattern.test(token)) throw new ConfigurationError();
  return Object.freeze({ gateway: new URL("/integrations/mcp-tools", origin), token });
}
