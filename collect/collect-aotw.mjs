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
const runRoot = path.join(collectRoot, "runs", "aotw-film-2025-2026");
const selfTestMode = process.argv.includes("--self-test");
const args = parseCollectorArgs(process.argv.slice(2).filter((item) => item !== "--self-test"), {
  checkpoint: path.join(runRoot, "checkpoint.json"),
  output: path.join(runRoot, "records.json"),
});
if (args.help) {
  console.log(collectorUsage("collect-aotw.mjs"));
  process.exit(0);
}

const scope = {
  countries: "all",
  industries: "all",
  medium_types: ["Film"],
  campaign_years: [2025, 2026],
  list_url: "https://www.adsoftheworld.com/medium_types/film",
};
const listExpression = `fetch(location.href,{credentials:"include"}).then(async response=>{if(!response.ok)throw new Error("AOTW list HTTP "+response.status);const html=await response.text();const doc=new DOMParser().parseFromString(html,"text/html");const text=doc.body?.innerText||"";const total=Number(text.match(/([0-9,]+) Campaigns/)?.[1]?.replaceAll(",","")||0);const items=[...new Map([...doc.querySelectorAll("a[href]")].map(a=>{try{const url=new URL(a.getAttribute("href"),location.href);if(!url.pathname.startsWith("/campaigns/")||url.pathname.endsWith("/new"))return null;return [url.pathname,{source_record_id:url.pathname.split("/").filter(Boolean).at(-1),source_detail_url:url.origin+url.pathname,title:(a.innerText||"").trim()}]}catch{return null}}).filter(Boolean)).values()];const last=Math.max(1,...[...doc.querySelectorAll("a[href*=\\"page=\\"]")].map(a=>Number(new URL(a.getAttribute("href"),location.href).searchParams.get("page"))||1));return JSON.stringify({total,last_page:last,items})})`;

function isListPageReady(parsed, pageNumber) {
  if (!(parsed.total > 0 && parsed.last_page > 1)) return false;
  if (pageNumber > parsed.last_page) return true;
  return parsed.items.length >= (pageNumber === parsed.last_page ? 1 : 50);
}

function parseDetailText(text, fallbackTitle = null) {
  const publishedWithCountry = text.match(/This\s+(professional|student)\s+campaign\s+titled\s+([\s\S]+?)\s+was published in\s+(.+?)\s+in\s+([A-Za-z]+),\s*(20\d{2})\./i);
  const publishedOnDay = text.match(/This\s+(professional|student)\s+campaign\s+titled\s+([\s\S]+?)\s+was published on\s+([A-Za-z]+)\s+(\d{1,2}),\s*(20\d{2})\./i);
  const publishedInMonth = text.match(/This\s+(professional|student)\s+campaign\s+titled\s+([\s\S]+?)\s+was published in\s+([A-Za-z]+),\s*(20\d{2})\./i);
  const published = publishedWithCountry || publishedOnDay || publishedInMonth;
  const creationText = text.match(/It was created for the brands?:\s*([^\n.]*)\./i)?.[1]?.trim() || null;
  const brandLabel = creationText?.replace(/,\s*by\s+(?:ad agency|school):[\s\S]*$/i, "").replace(/,\s*$/, "").trim() || null;
  const agency = creationText?.match(/,\s*by\s+(?:ad agency|school):\s*([\s\S]+)$/i)?.[1]?.trim() || null;
  const medium = text.match(/This\s+([^\n.]+?)\s+(?:medium|media)\s+campaign\b/i);
  const industry = text.match(/(?:medium|media)\s+campaign\s+is related to the\s+([\s\S]+?)\s+industr(?:y|ies)(?=\s+and contains|\.)/i);
  const mediaCount = text.match(/\bcontains\s+(\d+)\s+media assets?\b/i);
  const publishedSentence = text.match(/This\s+(?:professional|student)\s+campaign\s+titled[\s\S]+?contains\s+\d+\s+media assets?\./i)?.[0] || null;
  const splitValues = (value) => [...new Set(String(value || "").split(/\s*(?:,|\band\b)\s*/i).map((item) => item.trim()).filter(Boolean))];
  const brands = splitValues(brandLabel);
  const mediumTypes = splitValues(medium?.[1]);
  const industries = splitValues(industry?.[1]);
  return {
    decision_ready: Boolean(publishedSentence && published && mediumTypes.length),
    published_sentence: publishedSentence,
    kind: published?.[1]?.toLowerCase() || null,
    title: published?.[2]?.trim().replace(/^['‘]|['’]$/g, "") || fallbackTitle,
    country: publishedWithCountry?.[3]?.trim() || null,
    month: publishedWithCountry?.[4] || publishedOnDay?.[3] || publishedInMonth?.[3] || null,
    day: publishedOnDay ? Number(publishedOnDay[4]) : null,
    year: publishedWithCountry ? Number(publishedWithCountry[5]) : publishedOnDay ? Number(publishedOnDay[5]) : publishedInMonth ? Number(publishedInMonth[4]) : null,
    publish_date_precision: publishedOnDay ? "day" : "month",
    brand: brands[0] || brandLabel,
    brands,
    agency,
    agencies: agency ? [agency] : [],
    medium_sentence: medium?.[1] || null,
    industry_sentence: industry?.[1]?.trim() || null,
    media_count: mediaCount ? Number(mediaCount[1]) : null,
    medium_types: mediumTypes,
    industries,
  };
}

function detailExpression(detailUrl) {
  return `JSON.stringify((() => {
    const expectedPath = new URL(${JSON.stringify(detailUrl)}).pathname;
    const text = document.body?.innerText || "";
    const blocked = /403 Forbidden|Access denied|Just a moment/i.test(document.title + "\\n" + text);
    const parsed = (${parseDetailText.toString()})(text, document.querySelector("h1")?.innerText?.trim() || null);
    const rawVideos = [];
    for (const [index, iframe] of [...document.querySelectorAll("iframe[src]")].entries()) {
      const locator = iframe.src || "";
      if (!/(?:youtube\\.com\\/embed|youtu\\.be|vimeo\\.com)/i.test(locator)) continue;
      rawVideos.push({ position: index + 1, name: null, thumbnail_url: null, upload_date: null, duration: null, locator });
    }
    for (const [index, element] of [...document.querySelectorAll("video[src],video source[src]")].entries()) {
      rawVideos.push({ position: rawVideos.length + index + 1, name: null, thumbnail_url: null, upload_date: null, duration: null, locator: element.src || element.getAttribute("src") });
    }
    const videos = [...new Map(rawVideos.map((item, index) => {
      const youtube = item.locator?.match(/(?:v=|youtu\\.be\\/|embed\\/)([A-Za-z0-9_-]{6,})/)?.[1] || null;
      const locator = youtube ? "https://www.youtube.com/watch?v=" + youtube : item.locator;
      return [youtube || locator, { ...item, position: index + 1, locator, youtube_id: youtube, thumbnail_url: item.thumbnail_url || (youtube ? "https://img.youtube.com/vi/" + youtube + "/0.jpg" : null) }];
    }).filter(([key]) => Boolean(key))).values()];
    const pathMatches = location.pathname === expectedPath;
    const ready = pathMatches && parsed.decision_ready;
    return {
      ...parsed,
      ready,
      blocked,
      diagnostics: { path_matches: pathMatches, published: Boolean(parsed.year), brand: Boolean(parsed.brand), medium: Boolean(parsed.medium_types.length), industry: Boolean(parsed.industries.length), sentence: Boolean(parsed.published_sentence) },
      page_title: document.title,
      description: document.querySelector("meta[name=description]")?.content || null,
      videos,
    };
  })())`;
}
const monthNumbers = new Map([
  ["january", 1], ["february", 2], ["march", 3], ["april", 4], ["may", 5], ["june", 6],
  ["july", 7], ["august", 8], ["september", 9], ["october", 10], ["november", 11], ["december", 12],
]);

function listUrl(page) {
  return page === 1 ? scope.list_url : `${scope.list_url}?page=${page}`;
}

function detailRecord(candidate, detail, mapping) {
  const collectedAt = new Date().toISOString();
  const month = monthNumbers.get(String(detail.month || "").toLowerCase());
  const day = Number(detail.day || 1);
  const campaignPublishedAt = detail.year && month && day >= 1 && day <= 31
    ? `${detail.year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;
  const classification = categoryCandidate(mapping, "ads_of_the_world", detail.industries || []);
  const mediaAssets = (detail.videos || []).map((video, index) => {
    const vimeoId = video.locator?.match(/vimeo\.com\/(?:video\/)?(\d+)/i)?.[1] || null;
    const assetId = video.youtube_id || vimeoId || `${candidate.source_record_id}-video-${video.position || index + 1}`;
    const provider = video.youtube_id
      ? "youtube"
      : vimeoId
        ? "vimeo"
        : video.locator?.includes(".m3u8")
          ? "hls"
          : video.locator?.includes("video.adsoftheworld.com")
            ? "aotw_cdn"
            : "mp4";
    return {
      asset_id: assetId,
      media_type: "video",
      provider,
      source_asset_id: assetId,
      original_url: video.locator,
      playback_url: video.youtube_id ? `https://www.youtube.com/embed/${video.youtube_id}` : video.locator,
      thumbnail_url: video.thumbnail_url,
      duration_seconds: null,
      width: null,
      height: null,
      aspect_ratio: null,
      access_status: "unchecked",
      checked_at: null,
      expires_at: null,
      locator_is_temporary: false,
      contact_sheet_path: null,
      contact_sheet_status: "pending",
      failure_reason: null,
      title: video.name,
      source_uploaded_at: video.upload_date,
    };
  });
  let recordState = classification.status === "pending_category_review" ? "pending_category_review" : "ready_for_media_review";
  if (!detail.brand) recordState = "pending_brand";
  if (!mediaAssets.length) recordState = "pending_video";
  return baseRecord({
    source_site: "ads_of_the_world",
    source_record_id: candidate.source_record_id,
    source_detail_url: candidate.source_detail_url,
    source_categories: [],
    source_industries: detail.industries || [],
    source_medium_types: detail.medium_types || [],
    primary_brand: detail.brand,
    brands: detail.brands?.length ? detail.brands : detail.brand ? [detail.brand] : [],
    campaign_title: detail.title || candidate.title || "",
    description: detail.description,
    agency: detail.agency,
    country: detail.country,
    campaign_published_at: campaignPublishedAt,
    publish_date_source: "campaign_published_date",
    publish_date_confidence: "confirmed",
    campaign_year_status: `confirmed_${detail.year}`,
    collected_at: collectedAt,
    record_state: recordState,
    classification_candidate: classification,
    source_refs: mediaAssets.length
      ? mediaAssets.map((asset) => sourceRef("ads_of_the_world", candidate.source_record_id, candidate.source_detail_url, asset.source_asset_id, collectedAt))
      : [sourceRef("ads_of_the_world", candidate.source_record_id, candidate.source_detail_url, null, collectedAt)],
    media_assets: mediaAssets,
    raw_source: {
      campaign_kind: detail.kind,
      published_sentence: detail.published_sentence,
      campaign_published_precision: detail.publish_date_precision || "month",
      medium_sentence: detail.medium_sentence,
      industry_sentence: detail.industry_sentence,
      media_asset_count: detail.media_count,
      image_asset_count: Math.max(0, Number(detail.media_count || 0) - mediaAssets.length),
      agency_links: detail.agencies,
    },
  });
}

function normalizeStoredMediaProviders(records) {
  let changed = 0;
  for (const record of records) {
    for (const asset of record.media_assets || []) {
      const locator = asset.original_url || asset.playback_url || "";
      const vimeoId = locator.match(/vimeo\.com\/(?:video\/)?(\d+)/i)?.[1] || null;
      const provider = vimeoId
        ? "vimeo"
        : locator.includes("video.adsoftheworld.com")
          ? "aotw_cdn"
          : asset.provider;
      if (asset.provider === provider && (!vimeoId || asset.source_asset_id === vimeoId)) continue;
      const previousAssetId = asset.asset_id;
      asset.provider = provider;
      if (vimeoId) {
        asset.asset_id = vimeoId;
        asset.source_asset_id = vimeoId;
        for (const ref of record.source_refs || []) {
          if (ref.source_asset_id === previousAssetId) ref.source_asset_id = vimeoId;
        }
      }
      changed += 1;
    }
    const existingRefKeys = new Set((record.source_refs || []).map((ref) => `${ref.source_site}:${ref.source_record_id}:${ref.source_asset_id || ""}`));
    for (const asset of (record.media_assets || []).filter((item) => item.media_type === "video")) {
      const key = `${record.source_site}:${record.source_record_id}:${asset.source_asset_id || asset.asset_id}`;
      if (existingRefKeys.has(key)) continue;
      record.source_refs.push(sourceRef(record.source_site, record.source_record_id, record.source_detail_url, asset.source_asset_id || asset.asset_id, record.collected_at));
      existingRefKeys.add(key);
      changed += 1;
    }
  }
  return changed;
}

function detailDecision(detail) {
  if (detail.kind === "student") return { status: "skipped", reason: "student_campaign", keepRecord: false };
  if (![2025, 2026].includes(detail.year)) return { status: "skipped", reason: "campaign_year_out_of_scope", keepRecord: false };
  if (!(detail.medium_types || []).some((medium) => medium.toLowerCase() === "film")) return { status: "skipped", reason: "film_medium_missing", keepRecord: false };
  if (!(detail.videos || []).length) return { status: "skipped", reason: "video_missing", keepRecord: false };
  if (!detail.brand) return { status: "skipped", reason: "brand_missing", keepRecord: true };
  return { status: "success", reason: "target_campaign_with_video", keepRecord: true };
}

function reconcileStoredOutOfScopeRecords(store) {
  const targetYears = new Set([2025, 2026]);
  const removed = store.state.records.filter((record) => {
    const year = Number(String(record.campaign_published_at || "").slice(0, 4));
    return !targetYears.has(year);
  });
  if (!removed.length) return 0;
  const removedIds = new Set(removed.map((record) => record.source_record_id));
  store.state.records = store.state.records.filter((record) => !removedIds.has(record.source_record_id));
  for (const record of removed) {
    store.addOutcome({
      source_record_id: record.source_record_id,
      status: "skipped",
      reason: "campaign_year_out_of_scope",
      attempts: store.priorFailures(record.source_record_id) + 1,
    });
  }
  return removed.length;
}

async function run() {
  const startedAt = Date.now();
  const mapping = await loadCategoryMapping();
  const store = new CheckpointStore("ads_of_the_world", scope, args);
  const browser = new BrowserSession(args.proxy, args.delayMs);
  await store.load();
  normalizeStoredMediaProviders(store.state.records);
  reconcileStoredOutOfScopeRecords(store);
  let stopReason = null;
  try {
    if (args.phase !== "details") {
      let pagesThisRun = 0;
      for (let pageNumber = store.state.discovery.next_page || 1; ; pageNumber += 1) {
        if (args.maxListPages && pagesThisRun >= args.maxListPages) { stopReason = "max_list_pages"; break; }
        if (runtimeExpired(startedAt, args.maxRuntimeMinutes)) { stopReason = "max_runtime"; break; }
        const url = listUrl(pageNumber);
        const page = await withRetries(async () => {
          await browser.navigate(url);
          return browser.evaluateUntil(
            listExpression,
            (parsed) => isListPageReady(parsed, pageNumber),
          );
        }, args.retry, async () => { store.run.retried += 1; });
        if (pageNumber > page.last_page) {
          store.state.discovery.total_reported = page.total;
          store.state.discovery.last_page = page.last_page;
          store.state.discovery.next_page = page.last_page + 1;
          store.state.discovery.complete = true;
          break;
        }
        store.addDiscoveries(page.items.map((item) => ({ ...item, listing_url: url, listing_page: pageNumber })));
        store.state.discovery.completed_pages.push(url);
        store.state.discovery.total_reported = page.total;
        store.state.discovery.last_page = page.last_page;
        store.state.discovery.next_page = pageNumber + 1;
        store.run.list_pages_visited += 1;
        pagesThisRun += 1;
        if (!page.items.length || pageNumber >= page.last_page) {
          store.state.discovery.complete = true;
          break;
        }
        await store.save();
      }
    }

    if (stopReason === "max_list_pages" && args.phase === "all") stopReason = null;
    if (!stopReason && args.phase !== "discover") {
      for (const candidate of store.state.discovery.candidates) {
        if (store.hasTerminalOutcome(candidate.source_record_id)) continue;
        if (store.run.detail_pages_visited >= args.maxDetails) { stopReason = "max_details"; break; }
        if (runtimeExpired(startedAt, args.maxRuntimeMinutes)) { stopReason = "max_runtime"; break; }
        try {
          const detail = await withRetries(async () => {
            await browser.navigate(candidate.source_detail_url);
            const parsed = await browser.evaluateUntil(
              detailExpression(candidate.source_detail_url),
              (value) => value.blocked || value.ready,
            );
            if (parsed.blocked) throw new Error(`AOTW_DETAIL_BLOCKED:${parsed.page_title || "unknown"}`);
            return parsed;
          }, args.retry, async (retryNumber) => {
            store.run.retried += 1;
            await browser.pause(retryNumber + 1);
          });
          store.run.detail_pages_visited += 1;
          const decision = detailDecision(detail);
          if (decision.keepRecord) store.addRecord(detailRecord(candidate, detail, mapping));
          store.addOutcome({ source_record_id: candidate.source_record_id, status: decision.status, reason: decision.reason, attempts: store.priorFailures(candidate.source_record_id) + 1 });
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

function selfTestDetailParser() {
  const disneyText = "This professional campaign titled 'Once a Princess, Always a Princess: A Disney Short' was published in August, 2026. It was created for the brand: Disney. This Film medium campaign contains 1 media asset.";
  const spacetoonText = "This professional campaign titled 'Spacetoon Campaign' was published in Iraq in August, 2026. This Film medium campaign is related to the Entertainment industry and contains 1 media asset.";
  const multiMediumText = "This professional campaign titled 'Connect the Docs' was published in United States in August, 2026. It was created for the brand: Scribd. This Digital, Film, and OOH Outdoor media campaign is related to the Education industry and contains 3 media assets.";
  const legacyReady = (text) => {
    const published = /This\s+(professional|student)\s+campaign\s+titled\s+([\s\S]+?)\s+was published (?:in|on)/i.test(text);
    const brand = /It was created for the brands?:\s*([^\n.]*)\./i.test(text);
    const campaign = /This\s+([^\n.]+?)\s+(?:medium|media) campaign is related to the\s+([^\n.]+?)\s+industr(?:y|ies)\s+and contains\s+(\d+)\s+media assets?\./i.test(text);
    return published && brand && campaign;
  };
  const disney = parseDetailText(disneyText);
  const spacetoon = parseDetailText(spacetoonText);
  const multiMedium = parseDetailText(multiMediumText);
  const shrunkenLastPage = { total: 29702, last_page: 495, items: [{ source_record_id: "marksman" }, { source_record_id: "hilltop" }] };
  const outOfScopeMissingBrand = { kind: "professional", year: 2023, medium_types: ["Film"], videos: [{}], brand: null };
  const red = {
    disney_ready: legacyReady(disneyText),
    spacetoon_ready: legacyReady(spacetoonText),
    shrunken_last_page_ready: shrunkenLastPage.items.length >= (496 === shrunkenLastPage.last_page ? 1 : 50),
    out_of_scope_missing_brand_reason: !outOfScopeMissingBrand.brand ? "brand_missing" : "campaign_year_out_of_scope",
  };
  const green = {
    disney_ready: disney.decision_ready,
    disney_medium_types: disney.medium_types,
    disney_industries: disney.industries,
    spacetoon_ready: spacetoon.decision_ready,
    spacetoon_brand: spacetoon.brand,
    spacetoon_pending_reason: spacetoon.brand ? null : "brand_missing",
    multi_medium_types: multiMedium.medium_types,
    shrunken_last_page_ready: isListPageReady(shrunkenLastPage, 496),
    out_of_scope_missing_brand_decision: detailDecision(outOfScopeMissingBrand),
  };
  const ok = red.disney_ready === false
    && red.spacetoon_ready === false
    && red.shrunken_last_page_ready === false
    && red.out_of_scope_missing_brand_reason === "brand_missing"
    && green.disney_ready === true
    && green.disney_medium_types.includes("Film")
    && green.disney_industries.length === 0
    && green.spacetoon_ready === true
    && green.spacetoon_brand === null
    && green.spacetoon_pending_reason === "brand_missing"
    && green.shrunken_last_page_ready === true
    && green.out_of_scope_missing_brand_decision.reason === "campaign_year_out_of_scope"
    && green.out_of_scope_missing_brand_decision.keepRecord === false
    && ["Digital", "Film", "OOH Outdoor"].every((medium) => green.multi_medium_types.includes(medium));
  return { ok, red_to_green: { red: { ok: false, ...red }, green: { ok, ...green } } };
}

if (selfTestMode) {
  const summary = selfTestDetailParser();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
} else {
  await run();
}
