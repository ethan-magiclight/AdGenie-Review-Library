import fs from "node:fs/promises";

const partPaths = [
  "/tmp/adgenie-ce-v8/review-part-0.json",
  "/tmp/adgenie-ce-v8/review-part-1.json",
  "/tmp/adgenie-ce-v8/review-part-2.json",
];
const outputPath = new URL("./mvp-frame-review-v1.json", import.meta.url);

const parts = await Promise.all(
  partPaths.map(async (partPath) =>
    JSON.parse(await fs.readFile(partPath, "utf8")),
  ),
);
const records = parts
  .flatMap((part) => part.records)
  .sort((left, right) => left.video_id.localeCompare(right.video_id));
const uniqueIds = new Set(records.map((record) => record.video_id));
const sourceCandidateCount = parts[0].source_candidate_count;

if (records.length !== sourceCandidateCount || uniqueIds.size !== records.length) {
  throw new Error(
    `review merge mismatch: records=${records.length} unique=${uniqueIds.size} source=${sourceCandidateCount}`,
  );
}

await fs.writeFile(
  outputPath,
  `${JSON.stringify(
    {
      version: 1,
      updated_at: new Date().toISOString(),
      date_cutoff: parts[0].date_cutoff,
      sampling_points: parts[0].sampling_points,
      source_candidate_count: sourceCandidateCount,
      processed_count: records.length,
      records,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  JSON.stringify({
    records: records.length,
    unique_video_ids: uniqueIds.size,
    hard_filter_passed: records.filter(
      (record) => record.hard_filter_status === "passed",
    ).length,
    hard_filter_excluded: records.filter(
      (record) => record.hard_filter_status === "excluded",
    ).length,
    pending: records.filter(
      (record) => record.hard_filter_status === "pending",
    ).length,
    ten_frame_records: records.filter((record) => record.frames.length === 10)
      .length,
    output: outputPath.pathname,
  }),
);
