import fs from "node:fs/promises";

const root = "/Users/hakunamatata/Desktop/AdGenie";
const libraryV6 = JSON.parse(await fs.readFile(`${root}/collect/library-v6.json`, "utf8"));
const reviewV2 = JSON.parse(await fs.readFile(`${root}/collect/consumer-electronics-review-v2.json`, "utf8"));
const reviewV3 = JSON.parse(await fs.readFile(`${root}/collect/consumer-electronics-review-v3.json`, "utf8"));

const priorityCategories = new Set([
  "True Wireless / Bluetooth Earbuds",
  "Power Banks",
]);
const v2ByUrl = new Map(reviewV2.records.map((record) => [record.url, record]));
const v3ByUrl = new Map(reviewV3.records.map((record) => [record.url, record]));

const videos = libraryV6.videos.map((video) => {
  if (video.industry !== "Consumer Electronics" || !priorityCategories.has(video.product_category)) {
    return video;
  }
  const record = v3ByUrl.get(video.url);
  if (!record || record.status !== "accepted") return video;
  const previous = v2ByUrl.get(video.url);
  if (record.genres.join("\u0000") === (previous?.genres || []).join("\u0000")) return video;
  return {
    ...video,
    genres: record.genres,
    note: `${record.visual_notes}${record.duration_seconds ? `；时长 ${record.duration_seconds}s` : ""}`,
  };
});

const countBy = (key) => {
  const counts = {};
  for (const video of videos) {
    const values = Array.isArray(video[key]) ? video[key] : [video[key]];
    for (const value of values) if (value) counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
};

const targetGenres = reviewV3.criteria.target_genres;
const priorityVideos = videos.filter(
  (video) => video.industry === "Consumer Electronics" && priorityCategories.has(video.product_category),
);
const categoryCounts = {};
for (const category of priorityCategories) {
  categoryCounts[category] = Object.fromEntries(
    targetGenres.map((genre) => [
      genre,
      new Set(
        priorityVideos
          .filter((video) => video.product_category === category && video.genres.includes(genre))
          .map((video) => video.canonical_master_id || video.video_id),
      ).size,
    ]),
  );
}

const stats = {
  taxonomy_version: "v6-mvp-strict-labels",
  total: videos.length,
  topview_original: videos.filter((video) => video.source_type === "TopView skill 原始样片").length,
  later_collected: videos.filter((video) => video.source_type !== "TopView skill 原始样片").length,
  consumer_electronics_pilot_added: priorityVideos.length,
  core_cells: 11 * 29,
  by_industry: countBy("industry"),
  by_genre: countBy("genres"),
  consumer_electronics: {
    priority_categories: [...priorityCategories],
    target_genres: targetGenres,
    category_counts: categoryCounts,
    category_coverage: categoryCounts,
    priority_cells_with_samples: Object.values(categoryCounts).flatMap(Object.values).filter((count) => count > 0).length,
    priority_cells_ok: Object.values(categoryCounts).flatMap(Object.values).filter((count) => count >= 10).length,
    priority_cells_gap: Object.values(categoryCounts).flatMap(Object.values).filter((count) => count < 10).length,
    priority_relation_count: Object.values(categoryCounts).flatMap(Object.values).reduce((sum, count) => sum + count, 0),
  },
};

await fs.writeFile(`${root}/collect/library-v7.json`, `${JSON.stringify({ videos }, null, 2)}\n`, "utf8");
await fs.writeFile(`${root}/collect/stats-v7.json`, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ library: videos.length, priorityVideos: priorityVideos.length, stats }, null, 2));
