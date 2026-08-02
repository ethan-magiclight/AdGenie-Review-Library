import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const proxyBase = "http://localhost:3456";
const inputPath = new URL("./mvp-candidates-filtered-v1.json", import.meta.url);
const defaultOutputPath = new URL("./mvp-frame-review-v1.json", import.meta.url);
const outputPath = process.env.REVIEW_OUTPUT || defaultOutputPath;
const frameRoot = "/tmp/adgenie-ce-v8/frames";
const dateCutoff = "2018-07-31";
const sampleFractions = Array.from({ length: 10 }, (_, index) => index / 10);

const source = JSON.parse(await fs.readFile(inputPath, "utf8"));
const reviewOffset = Number(process.env.REVIEW_OFFSET || 0);
const reviewLimit = Number(
  process.env.REVIEW_LIMIT || source.candidates.length - reviewOffset,
);
const candidates = source.candidates.slice(
  reviewOffset,
  reviewOffset + reviewLimit,
);
await fs.mkdir(frameRoot, { recursive: true });

async function proxyGet(endpoint, params = {}) {
  const url = new URL(endpoint, proxyBase);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
  return response.json();
}

async function proxyEval(targetId, expression) {
  const response = await fetch(
    `${proxyBase}/eval?target=${encodeURIComponent(targetId)}`,
    { method: "POST", body: expression },
  );
  if (!response.ok) throw new Error(`/eval: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error);
  if (typeof payload.value !== "string") return payload.value;
  try {
    return JSON.parse(payload.value);
  } catch {
    return payload.value;
  }
}

const metadataExpression = `
(async () => {
  const response = window.ytInitialPlayerResponse || {};
  const videoDetails = response.videoDetails || {};
  const player = document.querySelector("#movie_player");
  const microformat = response.microformat?.playerMicroformatRenderer || {};
  const duration = Number(player?.getDuration?.() || videoDetails.lengthSeconds || 0);
  if (!(duration > 0)) {
    return JSON.stringify({ error: "video_metadata_not_ready", body: document.body.innerText.slice(0, 600) });
  }
  const channel = document.querySelector("ytd-channel-name a")?.textContent?.trim()
    || document.querySelector("#owner a")?.textContent?.trim()
    || microformat.ownerChannelName
    || videoDetails.author
    || null;
  const title = document.querySelector("h1 yt-formatted-string")?.textContent?.trim()
    || microformat.title?.simpleText
    || videoDetails.title
    || document.title.replace(/ - YouTube$/, "");
  return JSON.stringify({
    title,
    channel,
    duration_seconds: duration,
    publish_date: microformat.publishDate || microformat.uploadDate || null,
    video_id: videoDetails.videoId || new URL(location.href).searchParams.get("v"),
    storyboard_spec: response.storyboards?.playerStoryboardSpecRenderer?.spec || null,
    storyboard_recommended_level: response.storyboards?.playerStoryboardSpecRenderer?.recommendedLevel ?? null,
    is_playable: videoDetails.isPlayable ?? null,
    body_excerpt: document.body.innerText.slice(0, 1000),
  });
})()
`;

function parseStoryboardSpec(spec) {
  if (!spec) return null;
  const parts = spec.split("|");
  const baseUrl = parts[0];
  const levels = parts.slice(1).map((part, level) => {
    const [width, height, frameCount, columns, rows, intervalMs, nameTemplate, signature] =
      part.split("#");
    return {
      level,
      width: Number(width),
      height: Number(height),
      frame_count: Number(frameCount),
      columns: Number(columns),
      rows: Number(rows),
      interval_ms: Number(intervalMs),
      name_template: nameTemplate,
      signature,
    };
  });
  const level = levels.filter((item) => item.width > 0).at(-1);
  return level ? { base_url: baseUrl, ...level } : null;
}

async function downloadStoryboardFrames(videoId, durationSeconds, spec) {
  const level = parseStoryboardSpec(spec);
  if (!level) return [];
  const framesPerComposite = level.columns * level.rows;
  const refs = sampleFractions.map((fraction) => {
    const targetSeconds = Math.min(
      durationSeconds * fraction,
      Math.max(0, durationSeconds - level.interval_ms / 1000),
    );
    const frameIndex = Math.min(
      Math.floor((targetSeconds * 1000) / level.interval_ms),
      level.frame_count - 1,
    );
    const compositeIndex = Math.floor(frameIndex / framesPerComposite);
    const tileIndex = frameIndex % framesPerComposite;
    const compositeName =
      level.name_template === "default"
        ? "default"
        : level.name_template.replace("$M", String(compositeIndex));
    const compositeUrl = level.base_url
      .replace("$L", String(level.level))
      .replace("$N", compositeName)
      .concat(`&sigh=${level.signature}`);
    return {
      fraction,
      target_seconds: targetSeconds,
      frame_index: frameIndex,
      composite_index: compositeIndex,
      tile_index: tileIndex,
      tile_column: tileIndex % level.columns,
      tile_row: Math.floor(tileIndex / level.columns),
      width: level.width,
      height: level.height,
      columns: level.columns,
      rows: level.rows,
      composite_url: compositeUrl,
      composite_path: path.join(
        frameRoot,
        videoId,
        `L${level.level}-M${compositeIndex}.jpg`,
      ),
    };
  });

  await fs.mkdir(path.join(frameRoot, videoId), { recursive: true });
  const uniqueComposites = [
    ...new Map(refs.map((ref) => [ref.composite_path, ref])).values(),
  ];
  await Promise.all(
    uniqueComposites.map(async (ref) => {
      await execFileAsync(
        "/usr/bin/curl",
        ["-L", "-sS", "--max-time", "20", "-o", ref.composite_path, ref.composite_url],
        { maxBuffer: 1024 * 1024 },
      );
    }),
  );
  return refs;
}

const created = await proxyGet("/new", { url: "https://www.youtube.com/" });
const targetId = created.targetId;
const records = [];

try {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const category = candidate.discovery_matches[0].category;
    const expectedBrand = candidate.discovery_matches[0].expected_brand;
    const record = {
      video_id: candidate.video_id,
      url: candidate.url,
      product_category: category,
      expected_brand: expectedBrand,
      search_metadata: {
        title: candidate.title,
        channel: candidate.channel,
        duration_seconds: candidate.duration_seconds,
        channel_is_verified: candidate.channel_is_verified,
        view_count: candidate.view_count,
      },
      discovered_for_genres: [
        ...new Set(candidate.discovery_matches.map((match) => match.target_genre)),
      ],
      browser_metadata: null,
      hard_filter_status: "pending",
      hard_filter_reasons: [],
      frames: [],
      errors: [],
    };

    try {
      await proxyGet("/navigate", { target: targetId, url: candidate.url });
      record.browser_metadata = await proxyEval(targetId, metadataExpression);
      const metadata = record.browser_metadata || {};
      if (metadata.error) {
        record.hard_filter_status = "pending";
        record.errors.push(metadata.error);
      } else {
        if (metadata.video_id !== candidate.video_id) {
          record.hard_filter_reasons.push("video_id_mismatch");
        }
        if (!(metadata.duration_seconds > 15 && metadata.duration_seconds < 120)) {
          record.hard_filter_reasons.push("duration_outside_16_119_seconds");
        }
        if (metadata.publish_date && metadata.publish_date < dateCutoff) {
          record.hard_filter_reasons.push("published_more_than_8_years_ago");
        }
        if (record.hard_filter_reasons.length) {
          record.hard_filter_status = "excluded";
        } else {
          record.hard_filter_status = "passed";
          if (!metadata.storyboard_spec) {
            record.errors.push("storyboard_unavailable");
          } else {
            try {
              record.frames = await downloadStoryboardFrames(
                candidate.video_id,
                metadata.duration_seconds,
                metadata.storyboard_spec,
              );
            } catch (error) {
              record.errors.push(`storyboard: ${error.message}`);
            }
          }
        }
      }
    } catch (error) {
      record.errors.push(error.message);
    }

    records.push(record);
    await fs.writeFile(
      outputPath,
      `${JSON.stringify(
        {
          version: 1,
          updated_at: new Date().toISOString(),
          date_cutoff: dateCutoff,
          sampling_points: sampleFractions,
          source_candidate_count: source.candidates.length,
          review_offset: reviewOffset,
          review_limit: candidates.length,
          processed_count: records.length,
          records,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    process.stderr.write(
      `review ${index + 1}/${candidates.length} ${candidate.video_id} ${record.hard_filter_status} frames=${record.frames.length}\n`,
    );
  }
} finally {
  await proxyGet("/close", { target: targetId }).catch(() => null);
}

console.log(
  JSON.stringify({
    reviewed: records.length,
    hard_filter_passed: records.filter((record) => record.hard_filter_status === "passed").length,
    hard_filter_excluded: records.filter((record) => record.hard_filter_status === "excluded").length,
    pending: records.filter((record) => record.hard_filter_status === "pending").length,
    output: typeof outputPath === "string" ? outputPath : outputPath.pathname,
    frame_root: frameRoot,
  }),
);
