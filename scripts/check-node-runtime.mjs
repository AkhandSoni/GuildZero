const [major, minor, patch] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor < 22 || (minor === 22 && patch < 3)) {
  console.error(`GuildZero's Convex backend requires Node.js 24.22.3 or newer 24.x; current runtime is ${process.version}.`);
  console.error("Select Node 24 before starting the backend (with nvm: nvm install && nvm use). This prevents failed deployments from leaving stale backend functions running.");
  process.exit(1);
}
