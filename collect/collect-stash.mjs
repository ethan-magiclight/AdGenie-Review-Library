import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  baseRecord,
  BrowserSession,
  categoryCandidate,
  CheckpointStore,
  collectorUsage,
  loadCategoryMapping,
  parseCollectorArgs,
  runtimeExpired,
  sourceRef,
  withRetries,
} from "./source-collector-core.mjs";

const collectRoot = path.dirname(fileURLToPath(import.meta.url));
const runRoot = path.join(collectRoot, "runs", "stash-2025-2026");
const selfTestMode = process.argv.includes("--self-test");
const args = parseCollectorArgs(process.argv.slice(2).filter((item) => item !== "--self-test"), {
  checkpoint: path.join(runRoot, "checkpoint.json"),
  output: path.join(runRoot, "records.json"),
});
if (args.help) {
  console.log(`${collectorUsage("collect-stash.mjs")} [--self-test]`);
  process.exit(0);
}

const advertisingCategories = [
  "Advertising: All",
  "Advertising: Comedy",
  "Advertising: Holiday",
  "Advertising: Lifestyle",
  "Advertising: Food & Beverage",
  "Advertising: Automotive",
];
const issueDates = new Map([
  [170, { value: "2025-03", precision: "month", label: "Mar 2025", url: "https://www.stashmedia.tv/stash-issues-collection/" }],
  [171, { value: "2025-05", precision: "month", label: "May 2025", url: "https://www.stashmedia.tv/stash-issues-collection/" }],
  [172, { value: "2025-07", precision: "month", label: "Jul 2025", url: "https://www.stashmedia.tv/stash-issues-collection/" }],
  [173, { value: "2025-09", precision: "month", label: "Sep 2025", url: "https://www.stashmedia.tv/stash-issues-collection/" }],
  [174, { value: "2025-11", precision: "month", label: "Nov 2025", url: "https://www.stashmedia.tv/stash-issues-collection/" }],
  [175, { value: "2026-01", precision: "month", label: "Jan 2026", url: "https://www.stashmedia.tv/stash-issues-collection/" }],
  [176, { value: "2026-03", precision: "month", label: "Mar 2026", url: "https://www.stashmedia.tv/stash-issues-collection/" }],
  [177, { value: "2026-05-15", precision: "day", label: "STASH 177 MAY 15/26", url: "https://www.stashmedia.tv/issue/?refnum=VID177" }],
  [178, { value: "2026-07-15", precision: "day", label: "STASH 178 JULY 15/26", url: "https://www.stashmedia.tv/issue/?refnum=VID178" }],
]);
const scope = {
  source_category: "Advertising",
  playlists: advertisingCategories,
  discovery_playlist: "Advertising: All",
  discovery_url: "https://www.stashmedia.tv/playlist-flash/?fid=3540&pi=0&keyword=",
  fid: "3540",
  issues: [...issueDates.keys()],
  years: [2025, 2026],
  allowed_types: ["TVC", "Brand film", "Product film"],
  media_delivery_gate: "MEDIA_DELIVERY_BLOCKED",
};

const listExpression = `JSON.stringify((()=>{const text=document.body?.innerText||"";const total=Number(text.match(/([0-9,]+) videos/i)?.[1]?.replaceAll(",","")||0);const rows=[...document.querySelectorAll(".collection-playlist a[href*='refnum'][href*='clipnum']")].map(a=>{try{const url=new URL(a.href,location.href);const refnum=url.searchParams.get("refnum");const clipnum=url.searchParams.get("clipnum");const pi=url.searchParams.get("pi");if(!refnum||!clipnum||pi===null)return null;url.hash="";const lines=(a.innerText||a.textContent||"").split(/\\n+/).map(x=>x.trim()).filter(Boolean);return {source_record_id:refnum+":"+clipnum,source_detail_url:url.href,refnum,clipnum:Number(clipnum),pi:Number(pi),fid:url.searchParams.get("fid"),listing_title:lines[0]||null,listing_raw_type:lines.slice(1).join(" ")||null}}catch{return null}}).filter(Boolean);const maxPi=Math.max(-1,...rows.map(row=>row.pi));const items=[...new Map(rows.map(row=>[row.source_record_id,row])).values()];return {title:document.title,total,raw_links:rows.length,max_pi:maxPi,items,unique_candidates:items.length,ready:document.readyState==="complete"&&total>0&&maxPi>=0&&items.length>0}})())`;

function detailExpression(candidate) {
  const expectedIssue = Number(candidate.refnum.replace(/^VID/i, ""));
  const expectedClip = Number(candidate.clipnum);
  return `JSON.stringify((()=>{const q=s=>document.querySelector(s);const name=(q("#name_div")?.innerText||"").trim();const nameMatch=name.match(/STASH\\s+(\\d+)\\.(\\d+)/i);const expectedMatch=Boolean(nameMatch)&&Number(nameMatch[1])===${expectedIssue}&&Number(nameMatch[2])===${expectedClip};const titleLines=(q("#title_div")?.innerText||"").split(/\\n+/).map(x=>x.trim()).filter(Boolean);const copy=q("#copy_div");const lines=(copy?.innerText||"").split(/\\n+/).map(x=>x.trim()).filter(Boolean);const valueAfter=labels=>{const index=lines.findIndex(line=>labels.includes(line));return index>=0?lines[index+1]||null:null};const client=valueAfter(["Client"]);const agency=valueAfter(["Agency"]);const director=valueAfter(["Director","Directors"]);const production=valueAfter(["Production / Animation","Production","Animation"]);let description=null;const start=copy?.querySelector(".summary-start");const finish=copy?.querySelector(".summary-finish");if(copy&&start){const range=document.createRange();range.setStartAfter(start);if(finish)range.setEndBefore(finish);else range.setEndAfter(copy.lastChild);const holder=document.createElement("div");holder.append(range.cloneContents());description=(holder.innerText||holder.textContent||"").replace(/\\s+/g," ").trim()||null}const video=q("#video")||q("video");const source=video?(video.currentSrc||video.src||video.querySelector("source")?.src||""):"";let vimeoId=null;let mediaQueryKeys=[];try{const mediaUrl=new URL(source);vimeoId=mediaUrl.pathname.match(/playback\\/(\\d+)/)?.[1]||null;mediaQueryKeys=[...mediaUrl.searchParams.keys()].sort()}catch{}let thumbnail=null;try{const poster=new URL(video?.poster||"");thumbnail=poster.origin+poster.pathname}catch{}const body=document.body?.innerText||"";return {ready:expectedMatch&&titleLines.length>0&&Boolean(copy),expected_match:expectedMatch,name,campaign_title:titleLines[0]||null,raw_type:titleLines.slice(1).join(" ")||null,client,agency,directors:director?[director]:[],production_companies:production?[production]:[],description,vimeo_id:vimeoId,media_query_keys:mediaQueryKeys,thumbnail_url:thumbnail,download_required:body.includes("Download - Subscription required")}})())`;
}

function stableSourceKey(refnum, clipnum) {
  return `stash:${refnum}:${Number(clipnum)}`;
}

function issueEvidence(candidate) {
  return issueDates.get(Number(candidate.refnum.replace(/^VID/i, ""))) || null;
}

function normalizedMedium(rawType) {
  const value = String(rawType || "").trim();
  if (/^TVC\b/i.test(value)) return "TVC";
  if (/^Brand\s+film\b/i.test(value)) return "Brand film";
  if (/^Product\s+film\b/i.test(value)) return "Product film";
  return null;
}

function detailDecision(candidate, detail) {
  const dateEvidence = issueEvidence(candidate);
  if (!dateEvidence) return { status: "skipped", reason: "pending_year_evidence", keepRecord: false };
  if (/\bspec\b/i.test(detail.raw_type || candidate.listing_raw_type || "")) return { status: "skipped", reason: "spec_work", keepRecord: false };
  const medium = normalizedMedium(detail.raw_type || candidate.listing_raw_type);
  if (!medium) return { status: "skipped", reason: "non_advertising_media_type", keepRecord: false };
  if (!detail.client) return { status: "skipped", reason: "brand_missing", keepRecord: false };
  if (!detail.vimeo_id) return { status: "skipped", reason: "video_missing", keepRecord: false };
  return { status: "skipped", reason: "media_delivery_blocked", keepRecord: true };
}

function detailRecord(candidate, detail, mapping) {
  const collectedAt = new Date().toISOString();
  const dateEvidence = issueEvidence(candidate);
  const medium = normalizedMedium(detail.raw_type || candidate.listing_raw_type);
  const classification = categoryCandidate(mapping, "stash", ["Advertising: All"]);
  const stablePlayerUrl = detail.vimeo_id ? `https://player.vimeo.com/video/${detail.vimeo_id}` : null;
  const mediaAssets = detail.vimeo_id ? [{
    asset_id: detail.vimeo_id,
    media_type: "video",
    provider: "hls",
    source_asset_id: detail.vimeo_id,
    original_url: stablePlayerUrl,
    playback_url: null,
    thumbnail_url: detail.thumbnail_url,
    duration_seconds: null,
    width: null,
    height: null,
    aspect_ratio: null,
    access_status: "error",
    checked_at: collectedAt,
    expires_at: null,
    locator_is_temporary: false,
    contact_sheet_path: null,
    contact_sheet_status: "failed",
    failure_reason: "MEDIA_DELIVERY_BLOCKED:ten_item_resolver_gate_incomplete",
  }] : [];
  return baseRecord({
    source_site: "stash",
    source_record_id: `${candidate.refnum}:${Number(candidate.clipnum)}`,
    source_detail_url: candidate.source_detail_url,
    source_categories: ["Advertising: All"],
    source_industries: [],
    source_medium_types: medium ? [medium] : [],
    primary_brand: detail.client || null,
    brands: detail.client ? [detail.client] : [],
    campaign_title: detail.campaign_title || candidate.listing_title || "",
    description: detail.description,
    agency: detail.agency,
    production_companies: detail.production_companies || [],
    country: null,
    campaign_published_at: dateEvidence?.value || null,
    source_uploaded_at: null,
    publish_date_source: dateEvidence ? "stash_issue_date" : "unknown",
    publish_date_confidence: dateEvidence ? "confirmed" : "unknown",
    campaign_year_status: dateEvidence ? `confirmed_${dateEvidence.value.slice(0, 4)}` : "campaign_date_unverified",
    collected_at: collectedAt,
    record_state: "pending_video",
    classification_candidate: classification,
    source_refs: [sourceRef("stash", `${candidate.refnum}:${Number(candidate.clipnum)}`, candidate.source_detail_url, detail.vimeo_id, collectedAt)],
    media_assets: mediaAssets,
    raw_source: {
      stable_source_key: stableSourceKey(candidate.refnum, candidate.clipnum),
      fid: candidate.fid,
      refnum: candidate.refnum,
      clipnum: Number(candidate.clipnum),
      pi: candidate.pi,
      issue: Number(candidate.refnum.replace(/^VID/i, "")),
      issue_date_evidence: dateEvidence ? {
        value: dateEvidence.value,
        precision: dateEvidence.precision,
        source_label: dateEvidence.label,
        source_url: dateEvidence.url,
      } : null,
      source_playlist: "Advertising: All",
      raw_type: detail.raw_type || candidate.listing_raw_type,
      client: detail.client,
      agency: detail.agency,
      directors: detail.directors || [],
      production_companies: detail.production_companies || [],
      description: detail.description,
      detail_url: candidate.source_detail_url,
      vimeo_id: detail.vimeo_id,
      media_query_keys: detail.media_query_keys || [],
      signed_media_url_persisted: false,
      download_status: detail.download_required ? "subscription_required" : "not_observed",
      media_delivery_status: "resolver_implemented_trial_gate_pending",
    },
  });
}

function runSelfTest() {
  const candidate = { refnum: "VID178", clipnum: 3, listing_raw_type: "TVC :51" };
  const validDetail = { raw_type: "TVC :51", client: "BBC", vimeo_id: "1207188087" };
  const specDetail = { ...validDetail, raw_type: "Brand film 1:16 (spec)" };
  const cases = [
    {
      case: "stable_source_key",
      red: { value: `stash:${candidate.refnum}:0` },
      green: { value: stableSourceKey(candidate.refnum, candidate.clipnum) },
      passed: stableSourceKey(candidate.refnum, candidate.clipnum) === "stash:VID178:3",
    },
    {
      case: "issue_date_beats_generic_og_date",
      red: { value: "2021-05-09", error: "GENERIC_OG_DATE" },
      green: { value: issueEvidence(candidate)?.value, source: issueEvidence(candidate)?.label },
      passed: issueEvidence(candidate)?.value === "2026-07-15",
    },
    {
      case: "spec_is_excluded",
      red: { reason: normalizedMedium(specDetail.raw_type) ? "accepted_by_medium_prefix" : "excluded" },
      green: { reason: detailDecision(candidate, specDetail).reason },
      passed: detailDecision(candidate, specDetail).reason === "spec_work",
    },
    {
      case: "single_stable_vimeo_locator_does_not_bypass_trial_gate",
      red: { status: "success", reason: "target_campaign_with_stash_vimeo_resolver" },
      green: detailDecision(candidate, validDetail),
      passed: detailDecision(candidate, validDetail).status === "skipped"
        && detailDecision(candidate, validDetail).reason === "media_delivery_blocked",
    },
  ];
  return { ok: cases.every((item) => item.passed), red_to_green: cases };
}

async function run() {
  const startedAt = Date.now();
  const mapping = await loadCategoryMapping();
  const store = new CheckpointStore("stash", scope, args);
  const browser = new BrowserSession(args.proxy, args.delayMs);
  await store.load();
  let stopReason = null;
  try {
    if (args.phase !== "details" && !store.state.discovery.complete) {
      if (args.maxListPages && args.maxListPages < 1) stopReason = "max_list_pages";
      if (!stopReason) {
        const page = await withRetries(async () => {
          await browser.navigate(scope.discovery_url);
          return browser.evaluateUntil(listExpression, (parsed) => parsed.ready, 30000);
        }, args.retry, async (retryNumber) => {
          store.run.retried += 1;
          await browser.pause(retryNumber + 1);
        });
        store.addDiscoveries(page.items);
        store.state.discovery.completed_pages.push(scope.discovery_url);
        store.state.discovery.total_reported = page.total;
        store.state.discovery.raw_links = page.raw_links;
        store.state.discovery.enumerated_candidates = page.unique_candidates;
        store.state.discovery.max_pi = page.max_pi;
        store.state.discovery.reported_total_gap = Math.max(0, page.total - (page.max_pi + 1));
        store.state.discovery.last_page = 1;
        store.state.discovery.next_page = store.state.discovery.reported_total_gap ? 1 : 2;
        store.state.discovery.complete = store.state.discovery.reported_total_gap === 0;
        store.run.list_pages_visited += 1;
        if (store.state.discovery.reported_total_gap) stopReason = "reported_total_gap";
        await store.save();
      }
    }

    if (!stopReason && args.phase !== "discover") {
      for (const candidate of store.state.discovery.candidates) {
        if (store.hasTerminalOutcome(candidate.source_record_id)) continue;
        if (store.run.detail_pages_visited >= args.maxDetails) { stopReason = "max_details"; break; }
        if (runtimeExpired(startedAt, args.maxRuntimeMinutes)) { stopReason = "max_runtime"; break; }
        try {
          const detail = await withRetries(async () => {
            await browser.navigate(candidate.source_detail_url);
            return browser.evaluateUntil(
              detailExpression(candidate),
              (parsed) => parsed.ready && parsed.expected_match,
              30000,
            );
          }, args.retry, async (retryNumber) => {
            store.run.retried += 1;
            await browser.pause(retryNumber + 1);
          });
          store.run.detail_pages_visited += 1;
          const decision = detailDecision(candidate, detail);
          if (decision.keepRecord) store.addRecord(detailRecord(candidate, detail, mapping));
          store.addOutcome({
            source_record_id: candidate.source_record_id,
            status: decision.status,
            reason: decision.reason,
            attempts: store.priorFailures(candidate.source_record_id) + 1,
          });
          if (decision.reason === "media_delivery_blocked") stopReason = "media_delivery_blocked";
        } catch (error) {
          store.run.detail_pages_visited += 1;
          store.addOutcome({
            source_record_id: candidate.source_record_id,
            status: "failed",
            reason: error.message,
            attempts: store.priorFailures(candidate.source_record_id) + 1,
          });
        }
        await store.save();
      }
    }
  } catch (error) {
    store.run.failed += 1;
    if (!stopReason) {
      if (error?.cause?.code === "ECONNREFUSED") stopReason = "collector_proxy_unavailable";
      else if (String(error?.message || "").startsWith("Timed out waiting for page evidence")) stopReason = "discovery_evidence_timeout";
      else stopReason = "collector_error";
    }
    throw error;
  } finally {
    await browser.close();
    await store.finish(stopReason);
  }
  console.log(JSON.stringify(store.summary(), null, 2));
}

if (selfTestMode) {
  const result = runSelfTest();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
} else {
  await run();
}
