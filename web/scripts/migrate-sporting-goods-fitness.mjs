import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");
const statePath = path.join(webRoot, "data", "creative-library-state.json");
const taxonomyPath = path.join(repoRoot, "collect", "sporting-goods-fitness-taxonomy-v1.json");
const dryRun = process.argv.includes("--dry-run");
const industry = "Sporting Goods & Fitness";
const targetGenres = [
  "TVC / Brand Commercial",
  "Concept Film / Brand Manifesto",
  "Story-Driven Product Ad",
  "Sports Hero Film",
  "Product Demo",
  "Feature Callout",
  "Problem–Solution",
  "Daily Routine",
  "UGC Ad",
  "Testimonial / Review",
  "Macro Close-Up",
  "Multi-Angle / 360° Product Showcase",
  "Try-On / Try-Out",
];

const [statePayload, taxonomyPayload] = await Promise.all([
  fs.readFile(statePath, "utf8"),
  fs.readFile(taxonomyPath, "utf8"),
]);
const state = JSON.parse(statePayload);
const taxonomy = JSON.parse(taxonomyPayload);

state.industries = (state.industries || []).filter((item) => item.industry !== industry);
state.industries.push({ industry, zh: "运动健身", priority: "P1" });
state.categories = (state.categories || []).filter((item) => item.industry !== industry);
state.categories.push(...taxonomy.categories.map((item) => ({ industry, ...item })));
state.target_genres_by_industry = {
  ...(state.target_genres_by_industry || {}),
  [industry]: targetGenres,
};
state.priority_categories_by_industry = {
  ...(state.priority_categories_by_industry || {}),
  [industry]: taxonomy.categories.filter((item) => item.priority === "P0").map((item) => item.category),
};
state.source_files = [...new Set([
  ...(state.source_files || []),
  "collect/sporting-goods-fitness-taxonomy-v1.json",
  "collect/sporting-goods-fitness-top-brands-v1.json",
  "collect/sporting-goods-fitness-source-registry-v1.json",
  "collect/sporting-goods-fitness-collection-policy-v1.json",
])];
state.updated_at = new Date().toISOString();

if (!dryRun) await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  dry_run: dryRun,
  industry,
  categories: taxonomy.categories.length,
  target_genres: targetGenres.length,
  preserved_videos: (state.videos || []).length,
  preserved_review_events: (state.review_events || []).length,
}, null, 2));
