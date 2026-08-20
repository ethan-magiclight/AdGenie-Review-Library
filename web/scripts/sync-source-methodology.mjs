import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSourceCollectionMethodology } from "../lib/source-methodology.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webRoot, "..");
const statePath = path.join(webRoot, "data", "creative-library-state.json");
const backupRoot = path.join(webRoot, "data", "backups");
const sourceRelativePath = "collect/source-collection-methodology-v1.json";
const sourcePath = path.join(repoRoot, sourceRelativePath);

async function requireFreshBackup() {
  const stateStat = await fs.stat(statePath);
  const files = await fs.readdir(backupRoot).catch(() => []);
  const backups = [];
  for (const file of files.filter((item) => /^creative-library-state\..+\.json$/.test(item))) {
    const filePath = path.join(backupRoot, file);
    const stat = await fs.stat(filePath);
    backups.push({ filePath, mtimeMs: stat.mtimeMs });
  }
  const latest = backups.sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  if (!latest || latest.mtimeMs < stateStat.mtimeMs) {
    throw new Error("Fresh backup required. Run: npm run backup:data");
  }
  return path.relative(repoRoot, latest.filePath);
}

const [state, sourceCollection] = await Promise.all([
  fs.readFile(statePath, "utf8").then(JSON.parse),
  fs.readFile(sourcePath, "utf8").then(JSON.parse),
]);
const errors = validateSourceCollectionMethodology(sourceCollection);
if (errors.length) throw new Error(`Invalid source collection methodology: ${errors.join("; ")}`);
const backup = await requireFreshBackup();

state.methodology = { ...(state.methodology || {}), source_collection: sourceCollection };
state.source_files = [...new Set([...(state.source_files || []), sourceRelativePath])];
state.updated_at = new Date().toISOString();
const temporaryPath = `${statePath}.tmp`;
await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
await fs.rename(temporaryPath, statePath);

console.log(JSON.stringify({
  ok: true,
  backup,
  source: sourceRelativePath,
  channels: sourceCollection.channels.map((channel) => ({ id: channel.id, status: channel.status, reviewable_total: channel.progress.reviewable_total })),
}, null, 2));
