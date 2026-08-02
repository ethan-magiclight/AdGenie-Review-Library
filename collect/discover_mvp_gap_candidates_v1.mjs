import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ytDlp = "/Users/hakunamatata/.local/bin/yt-dlp";
const collectDir = new URL("./", import.meta.url);
const reviewPath = new URL("./consumer-electronics-review-v4.json", collectDir);
const outputSuffix = process.env.GAP_OUTPUT_SUFFIX
  ? `-${process.env.GAP_OUTPUT_SUFFIX}`
  : "";
const rawOutputPath = new URL(`./mvp-gap-candidates-v1${outputSuffix}.json`, collectDir);
const shortlistOutputPath = new URL(
  `./mvp-gap-official-shortlist-v1${outputSuffix}.json`,
  collectDir,
);

const review = JSON.parse(await fs.readFile(reviewPath, "utf8"));
const acceptedRecords = review.records.filter((record) => record.status === "accepted");
const existingVideoIds = new Set(review.records.map((record) => record.video_id));
const existingUrls = new Set(review.records.map((record) => record.url));
const existingMasters = new Set(
  review.records.map((record) => record.canonical_master_id).filter(Boolean),
);
const targetGenres = review.criteria.target_genres;
const requestedGenres = new Set(
  (process.env.GAP_GENRES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const requestedCategories = new Set(
  (process.env.GAP_CATEGORIES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const queryLimit = Number(process.env.QUERY_LIMIT || 0);
const queryOffset = Number(process.env.QUERY_OFFSET || 0);
const playlistEnd = String(Number(process.env.PLAYLIST_END || 5));
const priorityCategories = [
  "Power Banks",
  "True Wireless / Bluetooth Earbuds",
];

function acceptedCount(category, genre) {
  return acceptedRecords.filter(
    (record) =>
      record.product_category === category &&
      Array.isArray(record.genres) &&
      record.genres.includes(genre),
  ).length;
}

const gaps = [];
for (const category of priorityCategories) {
  for (const genre of targetGenres) {
    const count = acceptedCount(category, genre);
    if (count < 10) {
      gaps.push({ category, genre, current_count: count, deficit: 10 - count });
    }
  }
}

const topBrands = {
  "True Wireless / Bluetooth Earbuds": [
    ["Apple", "AirPods"],
    ["Beats", "Beats earbuds"],
    ["Samsung", "Galaxy Buds"],
    ["Sony", "WF earbuds"],
    ["Bose", "QuietComfort Earbuds"],
    ["JBL", "JBL earbuds"],
    ["Sennheiser", "MOMENTUM True Wireless"],
    ["Huawei", "FreeBuds"],
    ["Xiaomi", "Xiaomi Buds"],
    ["Nothing", "Nothing Ear earbuds"],
    ["Jabra", "Jabra Elite earbuds"],
    ["Bang & Olufsen", "Beoplay earbuds"],
    ["OnePlus", "OnePlus Buds"],
    ["OPPO", "OPPO Enco earbuds"],
  ],
  "Power Banks": [
    ["Anker", "Anker power bank"],
    ["Belkin", "Belkin power bank"],
    ["Baseus", "Baseus power bank"],
    ["UGREEN", "UGREEN power bank"],
    ["Xiaomi", "Xiaomi power bank"],
    ["CUKTECH", "CUKTECH power bank"],
    ["SHARGE", "SHARGE power bank"],
    ["Zendure", "Zendure power bank"],
    ["Mophie", "Mophie power bank"],
    ["EcoFlow", "EcoFlow power bank"],
    ["ESR", "ESR power bank"],
  ],
};

const searchIntents = {
  "Multi-Angle / 360° Product Showcase": [
    "official product showcase",
    "official product design",
    "360 product showcase",
    "product details official",
    "design film official",
  ],
  "How-To Tutorial": [
    "official how to",
    "official setup guide",
    "official quick start",
    "official pairing guide",
    "official tutorial",
  ],
  Unboxing: [
    "official unboxing",
    "official first look",
    "what's in the box official",
    "packaging reveal official",
    "unbox official",
  ],
  Lookbook: [
    "official lookbook",
    "official style campaign",
    "lifestyle campaign",
    "street style campaign",
    "fashion campaign",
  ],
  "Daily Routine": [
    "daily routine official",
    "day in the life official",
    "morning routine official",
    "commute routine official",
    "travel lifestyle official",
    "workout lifestyle official",
  ],
  "Walk-and-Talk UGC": [
    "official vlog",
    "creator campaign",
    "walk and talk",
    "POV campaign",
    "UGC ad",
    "shorts campaign",
  ],
};

const channelPatterns = {
  Apple: /^Apple(?:\s|$)/i,
  Beats: /^Beats(?:\s|$)|^Beats by Dre$/i,
  Samsung: /^Samsung(?:\s|$)/i,
  Sony: /^Sony(?:\s|$)/i,
  Bose: /^Bose(?:\s|$)/i,
  JBL: /^JBL(?:\s|$)/i,
  Sennheiser: /^Sennheiser(?:\s|$)/i,
  Huawei: /^Huawei(?:\s|$)/i,
  Xiaomi: /^Xiaomi(?:\s|$)|^Redmi(?:\s|$)/i,
  Nothing: /^Nothing(?:\s|$)/i,
  Jabra: /^Jabra(?:\s|$)/i,
  "Bang & Olufsen": /^Bang\s*&\s*Olufsen(?:\s|$)/i,
  OnePlus: /^OnePlus(?:\s|$)/i,
  OPPO: /^OPPO(?:\s|$)/i,
  Anker: /^Anker(?:\s|$)/i,
  Belkin: /^Belkin(?:\s|$)/i,
  Baseus: /^Baseus(?:\s|$)/i,
  UGREEN: /^UGREEN(?:\s|$)/i,
  CUKTECH: /^CUKTECH(?:\s|$)/i,
  SHARGE: /^SHARGE(?:\s|$)/i,
  Zendure: /^Zendure(?:\s|$)/i,
  Mophie: /^Mophie(?:\s|$)|^ZAGG(?:\s|$)/i,
  EcoFlow: /^EcoFlow(?:\s|$)/i,
  ESR: /^ESR(?:\s|$)/i,
};

const productPatterns = {
  "True Wireless / Bluetooth Earbuds":
    /airpods|galaxy buds|earbuds|ear buds|true wireless|quietcomfort.*buds|wf-[a-z0-9]|linkbuds|momentum true wireless|accentum true wireless|beats fit pro|studio buds|nothing ear|freebuds|xiaomi buds|redmi buds|jabra elite|beoplay (?:eleven|ex|eq|e8)|tour pro|live pro|wave buds|reflect aero|oneplus buds|oppo enco/i,
  "Power Banks":
    /power\s*bank|battery\s*pack|portable charger|magsafe battery|magnetic battery|qi2 battery|charging bank|powercore|boostcharge|nexode|shargeek|supermini|supertank/i,
};

const excludedTitlePatterns = {
  "True Wireless / Bluetooth Earbuds":
    /open-ear|open ear|openfit|freeclip|ear clip|bone conduction|over-ear|headband|headphones?\b|neckband/i,
  "Power Banks":
    /portable power station|solar generator|car jump starter|jump starter|power strip|charging station|wall charger only/i,
};

const queries = [];
const activeGapKeys = new Set(gaps.map((gap) => `${gap.category}\u0000${gap.genre}`));
for (const category of priorityCategories) {
  if (requestedCategories.size && !requestedCategories.has(category)) continue;
  for (const [brand, product] of topBrands[category]) {
    for (const [genre, intents] of Object.entries(searchIntents)) {
      if (!activeGapKeys.has(`${category}\u0000${genre}`)) continue;
      if (requestedGenres.size && !requestedGenres.has(genre)) continue;
      for (const intent of intents) {
        queries.push({
          category,
          brand,
          genre,
          query: `${brand} ${product} ${intent}`,
        });
      }
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
        playlistEnd,
        `ytsearch${playlistEnd}:${item.query}`,
      ],
      { maxBuffer: 12 * 1024 * 1024 },
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
const concurrency = Number(process.env.DISCOVERY_CONCURRENCY || 8);
const selectedQueries = queryLimit > 0
  ? queries.slice(queryOffset, queryOffset + queryLimit)
  : queries.slice(queryOffset);
for (let index = 0; index < selectedQueries.length; index += concurrency) {
  const batch = selectedQueries.slice(index, index + concurrency);
  rawResults.push(...(await Promise.all(batch.map(runQuery))).flat());
  process.stderr.write(
    `gap discovery ${Math.min(index + concurrency, selectedQueries.length)}/${selectedQueries.length}\n`,
  );
}

const errors = rawResults.filter((item) => item.discovery_error);
const byVideo = new Map();
for (const item of rawResults) {
  if (!item.video_id) continue;
  const normalizedUrl = `https://www.youtube.com/watch?v=${item.video_id}`;
  if (existingVideoIds.has(item.video_id) || existingUrls.has(normalizedUrl)) continue;
  if (!(Number.isFinite(item.duration_seconds) && item.duration_seconds > 15 && item.duration_seconds < 120)) {
    continue;
  }

  const existing = byVideo.get(item.video_id);
  if (!existing) {
    byVideo.set(item.video_id, {
      video_id: item.video_id,
      url: normalizedUrl,
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

const candidates = [...byVideo.values()].map((candidate) => {
  const matches = [];
  const sourceTiers = new Set();
  for (const match of candidate.discovery_matches) {
    const title = candidate.title || "";
    const channel = candidate.channel || "";
    const channelPattern = channelPatterns[match.expected_brand];
    const productPattern = productPatterns[match.category];
    const excludedPattern = excludedTitlePatterns[match.category];
    const productOk = productPattern.test(title) && !excludedPattern.test(title);
    const officialOk = channelPattern?.test(channel) || false;
    if (officialOk && productOk) {
      sourceTiers.add("official_brand_channel");
      matches.push({ ...match, source_tier: "official_brand_channel" });
    } else if (productOk) {
      sourceTiers.add("creator_or_media_candidate");
      matches.push({ ...match, source_tier: "creator_or_media_candidate" });
    }
  }
  const uniqueMatches = [
    ...new Map(
      matches.map((match) => [
        `${match.category}\u0000${match.expected_brand}\u0000${match.target_genre}\u0000${match.source_tier}`,
        match,
      ]),
    ).values(),
  ];
  return {
    ...candidate,
    discovery_matches: uniqueMatches,
    source_tiers: [...sourceTiers].sort(),
    official_match_count: uniqueMatches.filter(
      (match) => match.source_tier === "official_brand_channel",
    ).length,
    creator_match_count: uniqueMatches.filter(
      (match) => match.source_tier === "creator_or_media_candidate",
    ).length,
  };
}).filter((candidate) => candidate.discovery_matches.length);

candidates.sort((left, right) => {
  const officialDiff = right.official_match_count - left.official_match_count;
  if (officialDiff !== 0) return officialDiff;
  const verifiedDiff = Number(right.channel_is_verified) - Number(left.channel_is_verified);
  if (verifiedDiff !== 0) return verifiedDiff;
  return (right.view_count || 0) - (left.view_count || 0);
});

const officialShortlist = candidates.filter((candidate) =>
  candidate.source_tiers.includes("official_brand_channel"),
);

await fs.writeFile(
  rawOutputPath,
  `${JSON.stringify(
    {
      version: 1,
      generated_at: new Date().toISOString(),
      source_review: "consumer-electronics-review-v4.json",
      duration_rule: "16-119 seconds",
      target_fill_rule: "10 unique canonical masters per product_category + genre",
      note: "discovery target genres are recall evidence only; official classification still requires visual review",
      gaps,
      total_query_count: queries.length,
      query_offset: queryOffset,
      query_count: selectedQueries.length,
      candidate_count: candidates.length,
      official_shortlist_count: officialShortlist.length,
      discovery_error_count: errors.length,
      candidates,
      errors,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

await fs.writeFile(
  shortlistOutputPath,
  `${JSON.stringify(
    {
      version: 1,
      generated_at: new Date().toISOString(),
      source: "mvp-gap-candidates-v1.json",
      candidate_count: officialShortlist.length,
      candidates: officialShortlist,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  JSON.stringify({
    gaps: gaps.length,
    total_query_count: queries.length,
    query_offset: queryOffset,
    query_count: selectedQueries.length,
    candidate_count: candidates.length,
    official_shortlist_count: officialShortlist.length,
    discovery_error_count: errors.length,
    raw_output: rawOutputPath.pathname,
    official_output: shortlistOutputPath.pathname,
    existing_masters: existingMasters.size,
  }, null, 2),
);
