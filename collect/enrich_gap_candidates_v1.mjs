import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ytDlp = "/Users/hakunamatata/.local/bin/yt-dlp";
const collectDir = new URL("./", import.meta.url);
const sourceFiles = (process.env.GAP_SHORTLIST_FILES || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const outputSuffix = process.env.GAP_OUTPUT_SUFFIX
  ? `-${process.env.GAP_OUTPUT_SUFFIX}`
  : "";
const outputPath = new URL(`./mvp-gap-enriched-v1${outputSuffix}.json`, collectDir);
const cutoff = new Date("2023-08-01T00:00:00+08:00");

if (!sourceFiles.length) {
  throw new Error("Set GAP_SHORTLIST_FILES to one or more shortlist JSON files.");
}

const sources = await Promise.all(
  sourceFiles.map(async (file) => {
    const url = file.startsWith("/")
      ? new URL(`file://${file}`)
      : new URL(file, collectDir);
    return JSON.parse(await fs.readFile(url, "utf8"));
  }),
);

const byVideo = new Map();
for (const source of sources) {
  for (const candidate of source.candidates || []) {
    const existing = byVideo.get(candidate.video_id);
    if (!existing) {
      byVideo.set(candidate.video_id, {
        ...candidate,
        discovery_matches: [...(candidate.discovery_matches || [])],
      });
    } else {
      existing.discovery_matches.push(...(candidate.discovery_matches || []));
    }
  }
}

function parseUploadDate(value) {
  if (!value || !/^\d{8}$/.test(value)) return null;
  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  return `${year}-${month}-${day}`;
}

async function enrich(candidate) {
  try {
    const { stdout } = await execFileAsync(
      ytDlp,
      [
        "--dump-json",
        "--skip-download",
        "--no-warnings",
        "--no-playlist",
        candidate.url,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const payload = JSON.parse(stdout.trim().split("\n").at(-1));
    const publishDate = parseUploadDate(payload.upload_date);
    const publishedAt = publishDate ? new Date(`${publishDate}T00:00:00+00:00`) : null;
    const duration = Number(payload.duration || candidate.duration_seconds);
    const hardFilterReasons = [];
    if (!(duration > 15 && duration < 120)) hardFilterReasons.push("DURATION_OUT_OF_RANGE");
    if (!publishDate) hardFilterReasons.push("PUBLISH_DATE_UNKNOWN");
    if (publishedAt && publishedAt < cutoff) hardFilterReasons.push("PUBLISHED_BEFORE_2023_08_01");
    return {
      ...candidate,
      enriched: {
        title: payload.title || candidate.title,
        fulltitle: payload.fulltitle || payload.title || candidate.title,
        description: payload.description || candidate.description || null,
        duration_seconds: duration,
        upload_date: payload.upload_date || null,
        publish_date: publishDate,
        channel: payload.channel || payload.uploader || candidate.channel,
        uploader: payload.uploader || null,
        channel_url: payload.channel_url || payload.uploader_url || candidate.channel_url,
        channel_id: payload.channel_id || candidate.channel_id,
        view_count: payload.view_count ?? candidate.view_count ?? null,
        tags: payload.tags || [],
        categories: payload.categories || [],
        webpage_url: payload.webpage_url || candidate.url,
      },
      hard_filter_status: hardFilterReasons.length ? "excluded" : "passed",
      hard_filter_reasons: hardFilterReasons,
      enrich_error: null,
    };
  } catch (error) {
    return {
      ...candidate,
      enriched: null,
      hard_filter_status: "pending",
      hard_filter_reasons: [],
      enrich_error: error.message,
    };
  }
}

const records = [];
const candidates = [...byVideo.values()];
const concurrency = Number(process.env.ENRICH_CONCURRENCY || 4);
for (let index = 0; index < candidates.length; index += concurrency) {
  const batch = candidates.slice(index, index + concurrency);
  records.push(...(await Promise.all(batch.map(enrich))));
  process.stderr.write(
    `gap enrich ${Math.min(index + concurrency, candidates.length)}/${candidates.length}\n`,
  );
}

records.sort((left, right) => {
  const statusDiff = left.hard_filter_status.localeCompare(right.hard_filter_status);
  if (statusDiff !== 0) return statusDiff;
  return (right.enriched?.view_count || right.view_count || 0) -
    (left.enriched?.view_count || left.view_count || 0);
});

await fs.writeFile(
  outputPath,
  `${JSON.stringify(
    {
      version: 1,
      generated_at: new Date().toISOString(),
      source_files: sourceFiles,
      cutoff_date: "2023-08-01",
      candidate_count: records.length,
      passed_count: records.filter((record) => record.hard_filter_status === "passed").length,
      excluded_count: records.filter((record) => record.hard_filter_status === "excluded").length,
      pending_count: records.filter((record) => record.hard_filter_status === "pending").length,
      records,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      candidate_count: records.length,
      passed_count: records.filter((record) => record.hard_filter_status === "passed").length,
      excluded_count: records.filter((record) => record.hard_filter_status === "excluded").length,
      pending_count: records.filter((record) => record.hard_filter_status === "pending").length,
      output: outputPath.pathname,
    },
    null,
    2,
  ),
);
