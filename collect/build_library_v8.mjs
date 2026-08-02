import fs from "node:fs/promises";

const root = "/Users/hakunamatata/Desktop/AdGenie";
const libraryBaseFile = process.env.LIBRARY_BASE_FILE || "library-v6.json";
const reviewFile = process.env.REVIEW_FILE || "consumer-electronics-review-v4.json";
const libraryOutputFile = process.env.LIBRARY_OUTPUT_FILE || "library-v8.json";
const statsOutputFile = process.env.STATS_OUTPUT_FILE || "stats-v8.json";
const taxonomyVersion = process.env.TAXONOMY_VERSION || "v8-mvp-full-semantic-review";
const libraryV6 = JSON.parse(await fs.readFile(`${root}/collect/${libraryBaseFile}`, "utf8"));
const reviewV4 = JSON.parse(await fs.readFile(`${root}/collect/${reviewFile}`, "utf8"));

const priorityCategories = new Set(["True Wireless / Bluetooth Earbuds", "Power Banks"]);
const retainedBaseVideos = libraryV6.videos.filter(
  (video) => !(video.industry === "Consumer Electronics" && priorityCategories.has(video.product_category)),
);
const reviewedVideos = reviewV4.records
  .filter((record) => record.status === "accepted" && record.core_template_eligible)
  .map((record) => ({
    industry: "Consumer Electronics",
    brand: record.brand,
    title: record.title,
    url: record.url,
    genres: record.genres,
    source_type: record.source_type,
    note: record.visual_notes,
    product_category: record.product_category,
    video_id: record.video_id,
    canonical_master_id: record.canonical_master_id,
    primary_genre: record.primary_genre,
    secondary_genres: record.secondary_genres,
    publish_date: record.publish_date,
    duration_seconds: record.duration_seconds,
  }));
const videos = [...reviewedVideos, ...retainedBaseVideos];

const countBy = (key) => {
  const counts = {};
  for (const video of videos) {
    const values = Array.isArray(video[key]) ? video[key] : [video[key]];
    for (const value of values) if (value) counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
};

const targetGenres = reviewV4.criteria.target_genres;
const categoryCounts = {};
for (const category of priorityCategories) {
  categoryCounts[category] = Object.fromEntries(
    targetGenres.map((genre) => [
      genre,
      new Set(
        reviewedVideos
          .filter((video) => video.product_category === category && video.genres.includes(genre))
          .map((video) => video.canonical_master_id),
      ).size,
    ]),
  );
}

const counts = Object.values(categoryCounts).flatMap(Object.values);
const stats = {
  taxonomy_version: taxonomyVersion,
  review_version: reviewV4.version,
  total: videos.length,
  topview_original: videos.filter((video) => video.source_type === "TopView skill 原始样片").length,
  later_collected: videos.filter((video) => video.source_type !== "TopView skill 原始样片").length,
  consumer_electronics_pilot_added: reviewedVideos.length,
  core_cells: 11 * 29,
  by_industry: countBy("industry"),
  by_genre: countBy("genres"),
  consumer_electronics: {
    priority_categories: [...priorityCategories],
    target_genres: targetGenres,
    category_counts: categoryCounts,
    category_coverage: categoryCounts,
    priority_cells_with_samples: counts.filter((count) => count > 0).length,
    priority_cells_ok: counts.filter((count) => count >= 10).length,
    priority_cells_gap: counts.filter((count) => count < 10).length,
    priority_relation_count: counts.reduce((sum, count) => sum + count, 0),
    unique_core_template_masters: reviewedVideos.length,
  },
};

await fs.writeFile(`${root}/collect/${libraryOutputFile}`, `${JSON.stringify({ videos }, null, 2)}\n`, "utf8");
await fs.writeFile(`${root}/collect/${statsOutputFile}`, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ library: videos.length, priorityVideos: reviewedVideos.length, stats: stats.consumer_electronics }, null, 2));
