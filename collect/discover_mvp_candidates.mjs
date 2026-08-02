import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ytDlp = "/Users/hakunamatata/.local/bin/yt-dlp";
const outputPath = new URL("./mvp-candidates-v1.json", import.meta.url);

const categories = [
  {
    category: "True Wireless / Bluetooth Earbuds",
    brands: [
      ["Apple", "AirPods"],
      ["Samsung", "Galaxy Buds"],
      ["Sony", "WF earbuds"],
      ["Bose", "QuietComfort Earbuds"],
      ["JBL", "JBL earbuds"],
      ["Sennheiser", "MOMENTUM True Wireless"],
      ["Beats", "Beats earbuds"],
      ["Nothing", "Nothing Ear"],
      ["Huawei", "FreeBuds"],
      ["Xiaomi", "Xiaomi Buds"],
      ["Jabra", "Jabra Elite earbuds"],
      ["Bang & Olufsen", "Beoplay earbuds"],
    ],
  },
  {
    category: "Power Banks",
    brands: [
      ["Anker", "Anker power bank"],
      ["Belkin", "Belkin power bank"],
      ["UGREEN", "UGREEN power bank"],
      ["Baseus", "Baseus power bank"],
      ["Xiaomi", "Xiaomi power bank"],
      ["CUKTECH", "CUKTECH power bank"],
      ["Zendure", "Zendure power bank"],
      ["SHARGE", "SHARGE power bank"],
      ["EcoFlow", "EcoFlow power bank"],
    ],
  },
];

const searchIntents = [
  ["TVC / Brand Commercial", "official commercial"],
  ["Macro Close-Up", "official product video design"],
  ["Multi-Angle / 360° Product Showcase", "official product showcase"],
  ["Feature Callout", "official features video"],
  ["Product Demo", "official demo"],
  ["How-To Tutorial", "official how to"],
  ["Unboxing", "official unboxing"],
  ["Lookbook", "official lookbook lifestyle"],
  ["Daily Routine", "official daily routine lifestyle"],
  ["Walk-and-Talk UGC", "official vlog walk and talk"],
];

const queries = [];
for (const category of categories) {
  for (const [brand, product] of category.brands) {
    for (const [genre, intent] of searchIntents) {
      queries.push({
        category: category.category,
        brand,
        genre,
        query: `${brand} ${product} ${intent}`,
      });
    }
  }
}

async function runQuery(item) {
  try {
    const { stdout } = await execFileAsync(
      ytDlp,
      [
        "--flat-playlist",
        "--dump-single-json",
        "--playlist-end",
        "10",
        `ytsearch10:${item.query}`,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    const payload = JSON.parse(stdout);
    return (payload.entries || []).map((entry) => ({
      ...item,
      video_id: entry.id,
      url: entry.url || `https://www.youtube.com/watch?v=${entry.id}`,
      title: entry.title || null,
      description: entry.description || null,
      duration_seconds: entry.duration || null,
      channel: entry.channel || entry.uploader || null,
      channel_id: entry.channel_id || null,
      channel_url: entry.channel_url || entry.uploader_url || null,
      channel_is_verified: entry.channel_is_verified ?? null,
      view_count: entry.view_count ?? null,
    }));
  } catch (error) {
    return [{ ...item, discovery_error: error.message }];
  }
}

const rawResults = [];
const concurrency = 6;
for (let index = 0; index < queries.length; index += concurrency) {
  const batch = queries.slice(index, index + concurrency);
  rawResults.push(...(await Promise.all(batch.map(runQuery))).flat());
  process.stderr.write(`discovery ${Math.min(index + concurrency, queries.length)}/${queries.length}\n`);
}

const errors = rawResults.filter((item) => item.discovery_error);
const eligible = rawResults.filter(
  (item) =>
    item.video_id &&
    Number.isFinite(item.duration_seconds) &&
    item.duration_seconds > 15 &&
    item.duration_seconds < 120,
);
const byVideo = new Map();
for (const item of eligible) {
  const existing = byVideo.get(item.video_id);
  if (!existing) {
    byVideo.set(item.video_id, {
      video_id: item.video_id,
      url: `https://www.youtube.com/watch?v=${item.video_id}`,
      title: item.title,
      description: item.description,
      duration_seconds: item.duration_seconds,
      channel: item.channel,
      channel_id: item.channel_id,
      channel_url: item.channel_url,
      channel_is_verified: item.channel_is_verified,
      view_count: item.view_count,
      discovery_matches: [],
    });
  }
  byVideo.get(item.video_id).discovery_matches.push({
    category: item.category,
    expected_brand: item.brand,
    target_genre: item.genre,
    query: item.query,
  });
}

const candidates = [...byVideo.values()].sort((left, right) => {
  const verifiedDiff = Number(right.channel_is_verified) - Number(left.channel_is_verified);
  if (verifiedDiff !== 0) return verifiedDiff;
  return (right.view_count || 0) - (left.view_count || 0);
});

await fs.writeFile(
  outputPath,
  `${JSON.stringify(
    {
      version: 1,
      generated_at: new Date().toISOString(),
      duration_rule: ">15 and <120 seconds",
      query_count: queries.length,
      candidate_count: candidates.length,
      discovery_error_count: errors.length,
      candidates,
      errors,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  JSON.stringify({
    query_count: queries.length,
    candidate_count: candidates.length,
    discovery_error_count: errors.length,
    output: outputPath.pathname,
  }),
);
