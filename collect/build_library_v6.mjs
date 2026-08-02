import fs from "node:fs/promises";

const root = "/Users/hakunamatata/Desktop/AdGenie";
const review = JSON.parse(
  await fs.readFile(`${root}/collect/consumer-electronics-review-v2.json`, "utf8"),
);
const libraryV5 = JSON.parse(
  await fs.readFile(`${root}/collect/library-v5.json`, "utf8"),
);

const priorityCategories = new Set([
  "True Wireless / Bluetooth Earbuds",
  "Power Banks",
]);

// Existing records outside the two MVP priority categories remain the source
// of truth. Priority-category records are replaced by the frame-reviewed set
// so unverified/AI/talking-head entries cannot leak into v8.
const baseVideos = libraryV5.videos.filter(
  (video) => !(video.industry === "Consumer Electronics" && priorityCategories.has(video.product_category)),
);
const accepted = review.records.filter(
  (record) => record.status === "accepted" && record.genres.length > 0,
);

const byMaster = new Map();
for (const record of accepted) {
  const master = record.canonical_master_id || record.video_id;
  if (byMaster.has(master)) continue;
  byMaster.set(master, {
    industry: "Consumer Electronics",
    brand: record.brand,
    title: record.title,
    url: record.url,
    genres: record.genres,
    source_type: record.source_type,
    note: `${record.visual_notes}${record.duration_seconds ? `；时长 ${record.duration_seconds}s` : ""}`,
    product_category: record.product_category,
    video_id: record.video_id,
    canonical_master_id: master,
    duration_seconds: record.duration_seconds,
    publish_date: record.publish_date,
    quality_review: "frame-reviewed-v2",
  });
}

const videos = [
  ...baseVideos,
  ...[...byMaster.values()].sort((a, b) => {
    if (a.product_category !== b.product_category) {
      return a.product_category.localeCompare(b.product_category);
    }
    return `${a.brand} ${a.title}`.localeCompare(`${b.brand} ${b.title}`);
  }),
];

const output = { videos };
await fs.writeFile(
  `${root}/collect/library-v6.json`,
  `${JSON.stringify(output, null, 2)}\n`,
  "utf8",
);

const countBy = (key) => {
  const counts = {};
  for (const video of videos) {
    const value = video[key];
    if (Array.isArray(value)) {
      for (const item of value) counts[item] = (counts[item] || 0) + 1;
    } else if (value) {
      counts[value] = (counts[value] || 0) + 1;
    }
  }
  return counts;
};

const targetGenres = review.criteria.target_genres;
const consumerPriority = [...byMaster.values()];
const consumerCategoryCounts = {};
for (const category of priorityCategories) {
  consumerCategoryCounts[category] = {};
  for (const genre of targetGenres) {
    const masters = new Set(
      consumerPriority
        .filter((video) => video.product_category === category && video.genres.includes(genre))
        .map((video) => video.canonical_master_id),
    );
    consumerCategoryCounts[category][genre] = masters.size;
  }
}

const categories = [...new Set(consumerPriority.map((video) => video.product_category))];
const stats = {
  taxonomy_version: "v5-mvp-priority",
  total: videos.length,
  topview_original: libraryV5.videos.filter((video) => video.source_type === "TopView skill 原始样片").length,
  later_collected: videos.filter((video) => video.source_type !== "TopView skill 原始样片").length,
  consumer_electronics_pilot_added: consumerPriority.length,
  core_cells: 11 * 29,
  cells_with_samples: null,
  cells_ok: null,
  gaps: null,
  by_industry: countBy("industry"),
  by_genre: countBy("genres"),
  consumer_electronics: {
    priority_categories: [...priorityCategories],
    target_genres: targetGenres,
    category_counts: consumerCategoryCounts,
    category_coverage: Object.fromEntries(
      categories.map((category) => [
        category,
        Object.fromEntries(
          targetGenres.map((genre) => [genre, consumerCategoryCounts[category]?.[genre] || 0]),
        ),
      ]),
    ),
  },
};
const priorityPairs = Object.values(consumerCategoryCounts).flatMap((counts) => Object.values(counts));
stats.consumer_electronics.priority_cells_with_samples = priorityPairs.filter((count) => count > 0).length;
stats.consumer_electronics.priority_cells_ok = priorityPairs.filter((count) => count >= 10).length;
stats.consumer_electronics.priority_cells_gap = priorityPairs.filter((count) => count < 10).length;
stats.consumer_electronics.priority_relation_count = priorityPairs.reduce((sum, count) => sum + count, 0);

await fs.writeFile(
  `${root}/collect/stats-v6.json`,
  `${JSON.stringify(stats, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({
  library: `${root}/collect/library-v6.json`,
  stats: `${root}/collect/stats-v6.json`,
  total: videos.length,
  priority: consumerPriority.length,
  priorityCategoryCounts: consumerCategoryCounts,
}, null, 2));
