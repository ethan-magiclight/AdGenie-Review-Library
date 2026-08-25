import path from "node:path";

import {
  channels,
  pipelineRoot,
  readJson,
  recordChannel,
  recordsFrom,
  stripWorkflowFields,
  writeJsonAtomic,
} from "./lib.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const channel = argument("--channel");
const inputArgument = argument("--file");
if (!channels.includes(channel) || !inputArgument) {
  throw new Error("Usage: npm run merge -- --channel <channel> --file <records.json>");
}

const inputPath = path.resolve(process.cwd(), inputArgument);
const input = await readJson(inputPath);
const incoming = recordsFrom(input);
const sourcePath = path.join(pipelineRoot, "source", channel, "records.json");
const source = await readJson(sourcePath);

function stableId(record) {
  return record.video_id || record.id || (
    record.source_record_id ? `${channel}:${record.source_record_id}` : null
  );
}

const recordsById = new Map(source.records.map((record) => [stableId(record), record]));
let inserted = 0;
let updated = 0;

for (const record of incoming) {
  const detectedChannel = recordChannel(record);
  if (detectedChannel !== "unknown" && detectedChannel !== channel) {
    throw new Error(`Input record belongs to ${detectedChannel}, expected ${channel}`);
  }
  const id = stableId(record);
  if (!id) throw new Error("Incoming record is missing video_id, id and source_record_id");
  if (recordsById.has(id)) updated += 1;
  else inserted += 1;
  recordsById.set(id, stripWorkflowFields({
    ...recordsById.get(id),
    ...record,
    crawl_collected_at: record.crawl_collected_at || record.collected_at || null,
  }));
}

const records = [...recordsById.values()].sort((left, right) => stableId(left).localeCompare(stableId(right)));
await writeJsonAtomic(sourcePath, {
  ...source,
  pipeline_imported_at: new Date().toISOString(),
  count: records.length,
  records,
});

console.log(JSON.stringify({ channel, inserted, updated, total: records.length }, null, 2));
