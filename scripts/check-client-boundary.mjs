import fs from "node:fs";
import path from "node:path";
const root = ".next/static";
if (!fs.existsSync(root)) {
  console.error("Build first: .next/static is absent.");
  process.exit(1);
}
const forbidden = [
  "AGENT_PRIVATE_FLOORS_JSON",
  "reservePriceYocto",
  "minimumYocto",
  "NEAR_PRIVATE_KEY",
  "JWT_PRIVATE_KEY",
  "CONVEX_DEPLOY_KEY",
];
let scanned = 0;
const violations = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(js|json|map)$/.test(file)) {
      scanned++;
      const body = fs.readFileSync(file, "utf8");
      for (const name of forbidden)
        if (body.includes(name)) violations.push({ file, name });
    }
  }
}
walk(root);
if (violations.length) {
  console.error(JSON.stringify({ violations }, null, 2));
  process.exit(1);
}
console.log(
  `Client boundary passed: ${scanned} generated assets contain no private pricing fields or server-secret identifiers.`,
);
