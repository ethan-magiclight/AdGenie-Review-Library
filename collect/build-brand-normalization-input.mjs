#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const options = {
    input: null,
    output: path.join(scriptDir, "brand-normalization-input-v1.json"),
    sourceLabel: "review-console-current",
    capturedAt: new Date().toISOString().slice(0, 10),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--input") options.input = path.resolve(argv[++index]);
    else if (argument === "--output") options.output = path.resolve(argv[++index]);
    else if (argument === "--source-label") options.sourceLabel = argv[++index];
    else if (argument === "--captured-at") options.capturedAt = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }

  if (!options.input) throw new Error("--input is required; point it at the current review-console state JSON");
  return options;
}

function compactVideo(video, fallbackId) {
  const result = {};
  const fields = [
    "id",
    "video_id",
    "brand",
    "primary_brand",
    "title",
    "source_site",
    "source_platform",
    "industry",
    "core_template_eligible",
  ];
  for (const field of fields) {
    if (Object.hasOwn(video, field)) result[field] = video[field];
  }
  if (!result.id && !result.video_id) result.id = fallbackId;
  return result;
}

const options = parseArgs(process.argv.slice(2));
const sourceBytes = fs.readFileSync(options.input);
const source = JSON.parse(sourceBytes.toString("utf8"));
const videos = Object.entries(source.videos ?? {})
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([id, video]) => [id, compactVideo(video, id)]);

const snapshot = {
  version: 1,
  captured_at: options.capturedAt,
  source_label: options.sourceLabel,
  source_updated_at: source.updated_at ?? null,
  source_sha256: crypto.createHash("sha256").update(sourceBytes).digest("hex"),
  video_count: videos.length,
  fields: [
    "id",
    "video_id",
    "brand",
    "primary_brand",
    "title",
    "source_site",
    "source_platform",
    "industry",
    "core_template_eligible",
  ],
  videos: Object.fromEntries(videos),
};

fs.writeFileSync(options.output, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(JSON.stringify({ output: options.output, video_count: snapshot.video_count, source_sha256: snapshot.source_sha256 }, null, 2));
