import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const webRoot = path.resolve(path.dirname(__filename), "..");
const dataPath = path.join(webRoot, "data", "creative-library-state.json");
const backupRoot = path.join(webRoot, "data", "backups");
const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const backupPath = path.join(backupRoot, `creative-library-state.${stamp}.json`);

await fs.mkdir(backupRoot, { recursive: true });
await fs.copyFile(dataPath, backupPath);

console.log(JSON.stringify({ ok: true, backup: backupPath }, null, 2));
