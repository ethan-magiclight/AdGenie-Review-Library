import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const collectRoot = path.dirname(fileURLToPath(import.meta.url));
const mappingPath = path.join(collectRoot, "source-category-mapping-v1.json");
const maximumDetailsPerRun = 500;
const maximumRuntimeMinutes = 360;

export function parseCollectorArgs(argv, defaults) {
  const result = {
    phase: "all",
    dryRun: false,
    delayMs: 1250,
    retry: 2,
    maxDetails: maximumDetailsPerRun,
    maxRuntimeMinutes: maximumRuntimeMinutes,
    maxListPages: 0,
    checkpoint: defaults.checkpoint,
    output: defaults.output,
    proxy: process.env.WEB_ACCESS_PROXY || "http://localhost:3456",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`Missing value for ${item}`);
      index += 1;
      return value;
    };
    if (item === "--phase") result.phase = next();
    else if (item === "--dry-run") result.dryRun = true;
    else if (item === "--delay-ms") result.delayMs = Number(next());
    else if (item === "--retry") result.retry = Number(next());
    else if (item === "--max-details") result.maxDetails = Number(next());
    else if (item === "--max-runtime-minutes") result.maxRuntimeMinutes = Number(next());
    else if (item === "--max-list-pages") result.maxListPages = Number(next());
    else if (item === "--checkpoint") result.checkpoint = path.resolve(process.cwd(), next());
    else if (item === "--output") result.output = path.resolve(process.cwd(), next());
    else if (item === "--proxy") result.proxy = next();
    else if (item === "--help" || item === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${item}`);
  }
  if (!new Set(["discover", "details", "all"]).has(result.phase)) throw new Error("--phase must be discover, details, or all");
  for (const key of ["delayMs", "retry", "maxDetails", "maxRuntimeMinutes", "maxListPages"]) {
    if (!Number.isFinite(result[key]) || result[key] < 0) throw new Error(`Invalid numeric argument: ${key}`);
  }
  if (result.maxDetails > maximumDetailsPerRun) throw new Error(`--max-details cannot exceed ${maximumDetailsPerRun}`);
  if (result.maxRuntimeMinutes > maximumRuntimeMinutes) throw new Error(`--max-runtime-minutes cannot exceed ${maximumRuntimeMinutes}`);
  return result;
}

export function collectorUsage(script) {
  return `Usage: node collect/${script} [--phase discover|details|all] [--dry-run] [--delay-ms 1250] [--retry 2] [--max-details 500] [--max-runtime-minutes 360] [--max-list-pages N] [--checkpoint file] [--output file]`;
}

function emptyState(sourceSite, scope) {
  const now = new Date().toISOString();
  return {
    version: 1,
    source_site: sourceSite,
    scope,
    created_at: now,
    updated_at: now,
    discovery: { complete: false, candidates: [], completed_pages: [], next_page: 1, total_reported: null, last_page: null },
    records: [],
    outcomes: [],
    runs: [],
  };
}

export class CheckpointStore {
  constructor(sourceSite, scope, args) {
    this.sourceSite = sourceSite;
    this.scope = scope;
    this.args = args;
    this.state = emptyState(sourceSite, scope);
    this.run = {
      started_at: new Date().toISOString(),
      finished_at: null,
      dry_run: args.dryRun,
      phase: args.phase,
      discovered: 0,
      success: 0,
      skipped: 0,
      failed: 0,
      retried: 0,
      detail_pages_visited: 0,
      list_pages_visited: 0,
      stop_reason: null,
    };
  }

  async load() {
    try {
      const payload = JSON.parse(await fs.readFile(this.args.checkpoint, "utf8"));
      if (payload.source_site !== this.sourceSite) throw new Error(`Checkpoint source mismatch: ${payload.source_site}`);
      this.state = payload;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    this.state.discovery ||= emptyState(this.sourceSite, this.scope).discovery;
    this.state.discovery.candidates ||= [];
    this.state.discovery.completed_pages ||= [];
    this.state.records ||= [];
    this.state.outcomes ||= [];
    this.state.runs ||= [];
  }

  addDiscoveries(items) {
    const known = new Set(this.state.discovery.candidates.map((item) => item.source_record_id));
    for (const item of items) {
      if (known.has(item.source_record_id)) continue;
      this.state.discovery.candidates.push(item);
      known.add(item.source_record_id);
      this.run.discovered += 1;
    }
  }

  hasTerminalOutcome(sourceRecordId) {
    return this.state.outcomes.some((item) => item.source_record_id === sourceRecordId && ["success", "skipped"].includes(item.status));
  }

  priorFailures(sourceRecordId) {
    return this.state.outcomes.filter((item) => item.source_record_id === sourceRecordId && item.status === "failed").length;
  }

  addOutcome(outcome) {
    this.state.outcomes.push({ ...outcome, recorded_at: new Date().toISOString() });
    this.run[outcome.status] += 1;
  }

  addRecord(record) {
    const key = `${record.source_site}:${record.source_record_id}`;
    const index = this.state.records.findIndex((item) => `${item.source_site}:${item.source_record_id}` === key);
    if (index >= 0) this.state.records[index] = record;
    else this.state.records.push(record);
  }

  async save() {
    if (this.args.dryRun) return;
    this.state.updated_at = new Date().toISOString();
    await fs.mkdir(path.dirname(this.args.checkpoint), { recursive: true });
    const checkpointTemp = `${this.args.checkpoint}.tmp`;
    await fs.writeFile(checkpointTemp, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    await fs.rename(checkpointTemp, this.args.checkpoint);
    const batch = {
      version: 1,
      schema_version: "source-video-record-v1",
      source_site: this.sourceSite,
      scope: this.scope,
      generated_at: this.state.updated_at,
      records: this.state.records,
    };
    await fs.mkdir(path.dirname(this.args.output), { recursive: true });
    const outputTemp = `${this.args.output}.tmp`;
    await fs.writeFile(outputTemp, `${JSON.stringify(batch, null, 2)}\n`, "utf8");
    await fs.rename(outputTemp, this.args.output);
  }

  async finish(stopReason = null) {
    this.run.finished_at = new Date().toISOString();
    this.run.stop_reason = stopReason;
    this.state.runs.push(this.run);
    await this.save();
  }

  summary() {
    const terminal = new Set(this.state.outcomes.filter((item) => ["success", "skipped"].includes(item.status)).map((item) => item.source_record_id));
    return {
      ok: this.run.failed === 0,
      source_site: this.sourceSite,
      dry_run: this.args.dryRun,
      phase: this.args.phase,
      run: this.run,
      checkpoint: path.relative(process.cwd(), this.args.checkpoint),
      output: path.relative(process.cwd(), this.args.output),
      discovered_total: this.state.discovery.candidates.length,
      discovery_complete: this.state.discovery.complete,
      records_total: this.state.records.length,
      terminal_outcomes_total: terminal.size,
      details_remaining: this.state.discovery.candidates.filter((item) => !terminal.has(item.source_record_id)).length,
      run_outcome_preview: this.state.outcomes.slice(-10),
    };
  }
}

export class BrowserSession {
  constructor(proxy, delayMs) {
    this.proxy = proxy.replace(/\/$/, "");
    this.delayMs = delayMs;
    this.targetId = null;
  }

  async request(pathname, options = {}) {
    const response = await fetch(`${this.proxy}${pathname}`, { ...options, signal: AbortSignal.timeout(60000) });
    if (!response.ok) {
      const detail = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 500);
      throw new Error(`CDP proxy ${pathname} returned ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    return response.json();
  }

  async open(url) {
    await this.request("/targets");
    const query = new URLSearchParams({ url });
    const result = await this.request(`/new?${query}`);
    if (!result.targetId) throw new Error("CDP proxy did not return targetId");
    this.targetId = result.targetId;
  }

  async navigate(url) {
    if (!this.targetId) {
      await this.open(url);
      if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      return;
    }
    const query = new URLSearchParams({ target: this.targetId, url });
    await this.request(`/navigate?${query}`);
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }

  async evaluate(expression) {
    if (!this.targetId) throw new Error("Browser tab is not open");
    const result = await this.request(`/eval?target=${encodeURIComponent(this.targetId)}`, {
      method: "POST",
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: expression,
    });
    if (result.error) throw new Error(`CDP eval failed: ${result.error}`);
    return typeof result.value === "string" ? JSON.parse(result.value) : result.value;
  }

  async evaluateUntil(expression, predicate, timeoutMs = 15000) {
    const startedAt = Date.now();
    let latest = null;
    while (Date.now() - startedAt < timeoutMs) {
      latest = await this.evaluate(expression);
      if (predicate(latest)) return latest;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for page evidence: ${JSON.stringify(latest)?.slice(0, 500)}`);
  }

  async pause(multiplier = 1) {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs * multiplier));
  }

  async close() {
    if (!this.targetId) return;
    try {
      await this.request(`/close?target=${encodeURIComponent(this.targetId)}`);
    } finally {
      this.targetId = null;
    }
  }
}

export async function withRetries(task, retryCount, onRetry) {
  let lastError;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < retryCount) await onRetry(attempt + 1, error);
    }
  }
  throw lastError;
}

export function runtimeExpired(startedAt, maxRuntimeMinutes) {
  return Date.now() - startedAt >= maxRuntimeMinutes * 60_000;
}

export async function loadCategoryMapping() {
  return JSON.parse(await fs.readFile(mappingPath, "utf8"));
}

export function categoryCandidate(mapping, sourceSite, sourceValues) {
  const entries = (mapping.mappings || []).filter((entry) =>
    entry.source_site === sourceSite && sourceValues.includes(entry.source_value)
  );
  if (entries.length !== 1 || entries[0].status !== "mapped_candidate" || entries[0].candidates.length !== 1 || !entries[0].candidates[0].product_category) {
    return {
      industry: entries[0]?.candidates?.[0]?.industry || null,
      product_category: null,
      status: "pending_category_review",
      confidence: entries[0]?.candidates?.[0]?.confidence || 0,
      evidence: entries.flatMap((entry) => entry.candidates.flatMap((candidate) => candidate.evidence)).slice(0, 10).concat(entries.length ? [] : ["No reliable source-label mapping; visual product evidence required."]),
      alternatives: entries.flatMap((entry) => entry.candidates),
    };
  }
  const candidate = entries[0].candidates[0];
  return { ...candidate, status: "mapped_candidate" };
}

export function sourceRef(sourceSite, sourceRecordId, sourceDetailUrl, sourceAssetId, collectedAt) {
  return { source_site: sourceSite, source_record_id: sourceRecordId, source_detail_url: sourceDetailUrl, source_asset_id: sourceAssetId, relation: "primary", collected_at: collectedAt };
}

export function baseRecord(values) {
  return {
    schema_version: "source-video-record-v1",
    campaign_id: `${values.source_site}:${values.source_record_id}`,
    description: null,
    agency: null,
    production_companies: [],
    campaign_published_at: null,
    source_uploaded_at: null,
    canonical_master_id: null,
    review_status: "pending_review",
    approved: false,
    core_template_eligible: false,
    genres: [],
    ...values,
  };
}
