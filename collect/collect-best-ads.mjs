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
const runRoot = path.join(collectRoot, "runs", "best-ads-2025-2026");
const args = parseCollectorArgs(process.argv.slice(2), {
  checkpoint: path.join(runRoot, "checkpoint.json"),
  output: path.join(runRoot, "records.json"),
});
if (args.help) {
  console.log(collectorUsage("collect-best-ads.mjs"));
  process.exit(0);
}

const scope = {
  countries: [{ task_label: "United States", source_label: "United States of America", source_id: 220 }],
  medium_types: [{ source_label: "TV", source_id: 1 }],
  years: [2025, 2026],
  year_semantics: "Best Ads year filter and Uploaded are source ingestion time only; campaign year remains unverified.",
  categories: [
    { task_label: "Clothing & footwear", source_label: "Clothing & footwear", source_id: 19 },
    { task_label: "Confectionery & snacks", source_label: "Confectionery & snacks", source_id: 48 },
    { task_label: "Cosmetics & toiletries", source_label: "Cosmetics & toiletries", source_id: 9 },
    { task_label: "Drinks non-alcoholic", source_label: "Drinks, non-alcoholic", source_id: 10 },
    { task_label: "Food", source_label: "Food", source_id: 32 },
    { task_label: "Home appliances & furnishings", source_label: "Home appliances & furnishings", source_id: 53 },
    { task_label: "Home electronics", source_label: "Home electronics", source_id: 7 },
    { task_label: "Household garden & pets", source_label: "Household, garden & pets", source_id: 52 },
    { task_label: "Sportswear", source_label: "Sportswear", source_id: 57 },
  ],
};
const listExpression = `JSON.stringify((()=>{const body=document.body?.innerText||"";const summary=body.match(/Showing results:\\s*([0-9]+)-([0-9]+) of ([0-9]+)/);const explicitEmpty=document.readyState==="complete"&&body.includes("Filtering results by:");const items=[...new Map([...document.querySelectorAll("a[href*=\\"/ad/\\"]")].map(a=>{const match=a.href.match(/\\/ad\\/(\\d+)/);return match?[match[1],{source_record_id:match[1],source_detail_url:a.href}]:null}).filter(Boolean)).values()];return {summary_found:Boolean(summary)||explicitEmpty,items,total:summary?Number(summary[3]):items.length}})())`;
function detailExpression(detailUrl) {
  return `fetch(${JSON.stringify(detailUrl)},{credentials:"include"}).then(async response=>{if(!response.ok)throw new Error("Best Ads detail HTTP "+response.status);const html=await response.text();const doc=new DOMParser().parseFromString(html,"text/html");const text=doc.body?.innerText||"";const lines=text.split(/\\n+/).map(line=>line.trim()).filter(Boolean);const valueAfter=label=>{const index=lines.findIndex(line=>line===label);return index>=0?lines[index+1]||null:null};const safe=value=>{if(!value)return null;const url=new URL(value,${JSON.stringify(detailUrl)});return url.origin+url.pathname};const sources=[...new Map([...doc.querySelectorAll("video source[src],video[src]")].map(element=>{const value=element.getAttribute("src");if(!value)return null;const url=new URL(value,${JSON.stringify(detailUrl)});return [safe(value),{stable_url:safe(value),source_asset_id:url.pathname.split("/").pop()?.replace(/\\.[^.]+$/,"")||null,expires:url.searchParams.get("expires"),query_keys:[...url.searchParams.keys()]}]}).filter(Boolean)).values()];const category=[...doc.querySelectorAll("a[href*=\\"/category/\\"]")].map(a=>(a.innerText||"").trim()).filter(Boolean).at(-1)||valueAfter("Category");const client=[...doc.querySelectorAll("a[href*=\\"/client/\\"]")].map(a=>(a.innerText||"").trim()).filter(Boolean).at(0)||valueAfter("Client");const agency=[...doc.querySelectorAll("a[href*=\\"/agency/\\"]")].map(a=>(a.innerText||"").trim()).filter(Boolean).at(0)||valueAfter("Agency");return JSON.stringify({page_title:doc.title,campaign_title:(doc.title||"").replace(/^TV ad:\\s*/i,""),description:doc.querySelector("meta[name=description]")?.content||null,category,client,agency,uploaded:valueAfter("Uploaded"),thumbnail:doc.querySelector("meta[property=\\"og:image\\"]")?.content||null,media:sources,raw_labels:{category:valueAfter("Category"),client:valueAfter("Client"),agency:valueAfter("Agency"),uploaded:valueAfter("Uploaded")}})})`;
}

function listUrl(category, year, offset) {
  const query = new URLSearchParams({ q: "", category: String(category.source_id), adtype: "1", client: "", agency: "", prodco: "", country: "220", year: String(year), month: "", next: String(offset) });
  return `https://www.bestadsontv.com/search.php?${query}`;
}

function isoUploaded(value) {
  if (!value) return null;
  const date = new Date(`${value} 00:00:00 UTC`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function detailRecord(candidate, detail, mapping) {
  const collectedAt = new Date().toISOString();
  const classification = categoryCandidate(mapping, "best_ads", [detail.category || candidate.source_category]);
  const mediaAssets = (detail.media || []).map((media, index) => ({
    asset_id: media.source_asset_id || `${candidate.source_record_id}-${index + 1}`,
    media_type: "video",
    provider: "best_ads_signed_mp4",
    source_asset_id: media.source_asset_id || null,
    original_url: media.stable_url,
    playback_url: null,
    thumbnail_url: detail.thumbnail,
    duration_seconds: null,
    width: null,
    height: null,
    aspect_ratio: null,
    access_status: "temporary",
    checked_at: collectedAt,
    expires_at: media.expires ? new Date(Number(media.expires) * 1000).toISOString() : null,
    locator_is_temporary: true,
    contact_sheet_path: null,
    contact_sheet_status: "pending",
    failure_reason: null,
  }));
  const sourceAssetId = mediaAssets[0]?.source_asset_id || null;
  return baseRecord({
    source_site: "best_ads",
    source_record_id: candidate.source_record_id,
    source_detail_url: candidate.source_detail_url,
    source_categories: [detail.category || candidate.source_category].filter(Boolean),
    source_industries: [],
    source_medium_types: ["TV"],
    primary_brand: detail.client || null,
    brands: detail.client ? [detail.client] : [],
    campaign_title: detail.campaign_title || candidate.title || "",
    description: detail.description,
    agency: detail.agency,
    country: "United States",
    source_uploaded_at: isoUploaded(detail.uploaded),
    publish_date_source: "source_uploaded_only",
    publish_date_confidence: "unverified",
    campaign_year_status: "campaign_date_unverified",
    collected_at: collectedAt,
    record_state: detail.client ? "campaign_date_unverified" : "pending_brand",
    classification_candidate: classification,
    source_refs: [sourceRef("best_ads", candidate.source_record_id, candidate.source_detail_url, sourceAssetId, collectedAt)],
    media_assets: mediaAssets,
    raw_source: {
      listing_year_filter: candidate.listing_year,
      source_category_task_label: candidate.task_category,
      labels: detail.raw_labels,
      media_query_keys: (detail.media || []).map((media) => media.query_keys),
      note: "Signed query values were intentionally not persisted.",
    },
  });
}

async function run() {
  const startedAt = Date.now();
  const mapping = await loadCategoryMapping();
  const store = new CheckpointStore("best_ads", scope, args);
  const browser = new BrowserSession(args.proxy, args.delayMs);
  await store.load();
  let stopReason = null;
  try {
    if (args.phase !== "details") {
      let pagesThisRun = 0;
      discovery: for (const category of scope.categories) {
        for (const year of scope.years) {
          for (let offset = 1; ; offset += 18) {
            const url = listUrl(category, year, offset);
            if (store.state.discovery.completed_pages.includes(url)) continue;
            if (args.maxListPages && pagesThisRun >= args.maxListPages) { stopReason = "max_list_pages"; break discovery; }
            if (runtimeExpired(startedAt, args.maxRuntimeMinutes)) { stopReason = "max_runtime"; break discovery; }
            await withRetries(async () => { await browser.navigate(url); }, args.retry, async () => { store.run.retried += 1; });
            const page = await browser.evaluateUntil(
              listExpression,
              (parsed) => parsed.summary_found && (parsed.total === 0 || parsed.items.length > 0 || offset > parsed.total),
            );
            const discoveries = page.items.map((item) => ({ ...item, source_category: category.source_label, task_category: category.task_label, listing_year: year, listing_url: url }));
            store.addDiscoveries(discoveries);
            store.state.discovery.completed_pages.push(url);
            store.state.discovery.total_reported = (store.state.discovery.total_reported || 0) + (offset === 1 ? page.total : 0);
            store.run.list_pages_visited += 1;
            pagesThisRun += 1;
            await store.save();
            if (!page.items.length || offset + 18 > page.total) break;
          }
        }
      }
      if (!stopReason) store.state.discovery.complete = scope.categories.every((category) => scope.years.every((year) => store.state.discovery.completed_pages.includes(listUrl(category, year, 1))));
    }

    if (stopReason === "max_list_pages" && args.phase === "all") stopReason = null;
    if (!stopReason && args.phase !== "discover") {
      for (const candidate of store.state.discovery.candidates) {
        if (store.hasTerminalOutcome(candidate.source_record_id)) continue;
        if (store.run.detail_pages_visited >= args.maxDetails) { stopReason = "max_details"; break; }
        if (runtimeExpired(startedAt, args.maxRuntimeMinutes)) { stopReason = "max_runtime"; break; }
        try {
          const detail = await withRetries(async () => {
            if (!browser.targetId) await browser.open("https://www.bestadsontv.com/");
            await browser.pause();
            return browser.evaluateUntil(detailExpression(candidate.source_detail_url), (parsed) => Boolean(parsed.raw_labels?.uploaded));
          }, args.retry, async () => { store.run.retried += 1; });
          store.run.detail_pages_visited += 1;
          const record = detailRecord(candidate, detail, mapping);
          if (!record.primary_brand || !record.media_assets.length) {
            store.addOutcome({ source_record_id: candidate.source_record_id, status: "skipped", reason: !record.primary_brand ? "brand_missing" : "video_missing", attempts: store.priorFailures(candidate.source_record_id) + 1 });
          } else {
            store.addRecord(record);
            store.addOutcome({ source_record_id: candidate.source_record_id, status: "success", reason: "campaign_date_unverified", attempts: store.priorFailures(candidate.source_record_id) + 1 });
          }
        } catch (error) {
          store.run.detail_pages_visited += 1;
          store.addOutcome({ source_record_id: candidate.source_record_id, status: "failed", reason: error.message, attempts: store.priorFailures(candidate.source_record_id) + 1 });
        }
        await store.save();
      }
    }
  } finally {
    await browser.close();
    await store.finish(stopReason);
  }
  console.log(JSON.stringify(store.summary(), null, 2));
}

await run();
