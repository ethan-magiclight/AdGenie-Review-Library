#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { today } from "./brand-logo-runtime-v3.mjs";

const collectRoot = path.dirname(fileURLToPath(import.meta.url));
const mapping = JSON.parse(fs.readFileSync(path.join(collectRoot, "brand-normalization-map-v1.json"), "utf8"));
const sites = JSON.parse(fs.readFileSync(path.join(collectRoot, "brand-official-site-registry-v3.json"), "utf8"));
const assets = JSON.parse(fs.readFileSync(path.join(collectRoot, "brand-assets-v3", "registry.json"), "utf8"));
const siteById = new Map(sites.brands.map((brand) => [brand.canonical_brand_id, brand]));
const assetById = new Map(assets.brands.map((brand) => [brand.canonical_brand_id, brand]));

function assetPath(record) {
  if (record.normalized?.file) return `brand-assets-v3/${record.normalized.file}`;
  return record.normalized_file ?? null;
}

function sourcePath(record) {
  if (record.source?.file) return `brand-assets-v3/${record.source.file}`;
  return record.source_file ?? null;
}

function fileExists(relativePath) {
  return relativePath ? fs.existsSync(path.join(collectRoot, relativePath)) : false;
}

const brands = mapping.canonical_brands.map((brand) => {
  const site = siteById.get(brand.canonical_brand_id);
  const asset = assetById.get(brand.canonical_brand_id);
  const normalizedFile = assetPath(asset ?? {});
  const originalSourceFile = sourcePath(asset ?? {});
  return {
    canonical_brand_id: brand.canonical_brand_id,
    display_name: brand.display_name,
    mapped_video_count: brand.video_count,
    primary_video_count: brand.primary_video_count,
    raw_aliases: brand.raw_aliases,
    mapping_statuses: brand.mapping_statuses,
    identity_source_status: site?.status ?? "missing_identity_source",
    official_page_url: site?.official_page_url ?? null,
    campaign_fallback: site?.status === "verified_campaign_identity_no_official_site" ? site.evidence : null,
    logo_status: asset?.status ?? "missing_asset_record",
    source_file: originalSourceFile,
    source_file_exists: fileExists(originalSourceFile),
    normalized_file: normalizedFile,
    normalized_file_exists: fileExists(normalizedFile),
    source: asset?.source ?? null,
    normalized: asset?.normalized ?? null,
    approved_for_product: asset?.approved_for_product === true,
    permission_status: asset?.permission_status ?? "not_reviewed",
    policy_note: asset?.policy_note ?? null,
  };
}).sort((left, right) => right.mapped_video_count - left.mapped_video_count || left.display_name.localeCompare(right.display_name));

const incompleteStatuses = new Set([
  "missing_asset_record",
  "pending_official_site",
  "pending_asset_collection",
  "pending_campaign_frame_collection",
  "campaign_frame_network_retry_required",
  "campaign_frame_collection_needs_review",
  "asset_collection_needs_review",
  "asset_collection_network_retry_required",
  "official_asset_collected_quality_upgrade_required",
  "campaign_frame_collected_pending_crop_review",
  "rendered_page_logo_needs_review",
]);

const summary = {
  review_console_video_count: mapping.summary.video_count,
  canonical_brand_count: brands.length,
  official_site_brand_count: brands.filter((brand) => brand.official_page_url).length,
  campaign_fallback_brand_count: brands.filter((brand) => brand.campaign_fallback).length,
  brands_with_local_normalized_logo: brands.filter((brand) => brand.normalized_file_exists).length,
  brands_with_local_source_file: brands.filter((brand) => brand.source_file_exists).length,
  quality_upgrade_required: brands.filter((brand) => brand.logo_status === "official_asset_collected_quality_upgrade_required").length,
  low_resolution_official_fallbacks: brands.filter((brand) => brand.logo_status === "official_asset_low_resolution_fallback_pending_approval").length,
  source_or_collection_review_required: brands.filter((brand) => ["asset_collection_needs_review", "campaign_frame_collected_pending_crop_review"].includes(brand.logo_status)).length,
  network_retry_required: brands.filter((brand) => brand.logo_status === "asset_collection_network_retry_required").length,
  pending_collection: brands.filter((brand) => ["pending_official_site", "pending_asset_collection", "pending_campaign_frame_collection", "campaign_frame_network_retry_required", "campaign_frame_collection_needs_review", "missing_asset_record"].includes(brand.logo_status)).length,
  express_permission_blocks: brands.filter((brand) => brand.permission_status === "express_permission_required").length,
  approved_for_product: brands.filter((brand) => brand.approved_for_product).length,
  closure_ready_brand_count: brands.filter((brand) => brand.normalized_file_exists && !incompleteStatuses.has(brand.logo_status)).length,
};

const catalog = {
  version: 3,
  generated_at: today(),
  sources: {
    mapping: "brand-normalization-map-v1.json",
    identity_registry: "brand-official-site-registry-v3.json",
    asset_registry: "brand-assets-v3/registry.json",
  },
  summary,
  brands,
};
fs.writeFileSync(path.join(collectRoot, "brand-logo-catalog-v3.json"), `${JSON.stringify(catalog, null, 2)}\n`);

const statusCounts = Object.entries(brands.reduce((counts, brand) => {
  counts[brand.logo_status] = (counts[brand.logo_status] ?? 0) + 1;
  return counts;
}, {})).sort((left, right) => right[1] - left[1]);

const rows = brands.map((brand) => `| ${brand.display_name} | \`${brand.canonical_brand_id}\` | ${brand.mapped_video_count} | ${brand.identity_source_status} | ${brand.logo_status} | ${brand.normalized_file_exists ? brand.normalized_file : "-"} |`).join("\n");
const report = `# AdGenie 全量品牌 Logo 闭环报告 v3

更新日期：${today()}

## 汇总

| 指标 | 数量 |
|---|---:|
${Object.entries(summary).map(([key, value]) => `| ${key} | ${value} |`).join("\n")}

## 资产状态

| 状态 | 数量 |
|---|---:|
${statusCounts.map(([status, count]) => `| ${status} | ${count} |`).join("\n")}

## 全量目录

| 品牌 | ID | 视频数 | 身份来源 | Logo 状态 | 标准化文件 |
|---|---|---:|---|---|---|
${rows}
`;
fs.writeFileSync(path.join(collectRoot, "brand-logo-catalog-report-v3.md"), report);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
}

const cards = brands.map((brand) => {
  const preview = brand.normalized_file_exists
    ? `<img src="${escapeHtml(brand.normalized_file)}" alt="${escapeHtml(brand.display_name)} logo">`
    : `<span class="fallback">${escapeHtml(brand.display_name)}</span>`;
  return `<article data-status="${escapeHtml(brand.logo_status)}"><div class="preview">${preview}</div><div class="body"><h2>${escapeHtml(brand.display_name)}</h2><p>${brand.mapped_video_count} videos · ${escapeHtml(brand.canonical_brand_id)}</p><code>${escapeHtml(brand.logo_status)}</code></div></article>`;
}).join("\n");

const review = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AdGenie Brand Logo Closure Review v3</title><style>
*{box-sizing:border-box}body{margin:0;background:#080a0e;color:#f6f7f9;font:13px/1.4 Inter,Arial,sans-serif}header{position:sticky;top:0;z-index:2;padding:18px 24px;background:#080a0ef2;border-bottom:1px solid #272b34;backdrop-filter:blur(14px)}h1{margin:0 0 4px;font-size:23px}header p{margin:0;color:#9aa2af}.controls{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}button{padding:7px 11px;border:1px solid #343946;border-radius:999px;background:#151922;color:#dfe3e9;cursor:pointer}button.active{background:#ff633f;color:#fff;border-color:#ff633f}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;padding:20px 24px}article{overflow:hidden;border:1px solid #252a33;border-radius:14px;background:#11151b}.preview{display:flex;height:116px;align-items:center;justify-content:center;background:#fff}.preview img{display:block;width:72px;height:72px;object-fit:contain}.fallback{color:#333a45;font-weight:700}.body{padding:11px}.body h2{margin:0 0 2px;font-size:14px}.body p{margin:0 0 7px;color:#929ba9;font-size:11px}.body code{display:block;overflow:hidden;color:#ff987f;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.hidden{display:none}
</style></head><body><header><h1>AdGenie · ${summary.canonical_brand_count} Brand Logo Closure</h1><p>${summary.brands_with_local_normalized_logo} local previews · ${summary.closure_ready_brand_count} closure-ready · ${summary.pending_collection} pending</p><div class="controls"><button class="active" data-filter="all">All</button>${statusCounts.map(([status, count]) => `<button data-filter="${escapeHtml(status)}">${escapeHtml(status)} · ${count}</button>`).join("")}</div></header><main>${cards}</main><script>for(const button of document.querySelectorAll('button'))button.addEventListener('click',()=>{document.querySelector('button.active')?.classList.remove('active');button.classList.add('active');const filter=button.dataset.filter;for(const card of document.querySelectorAll('article'))card.classList.toggle('hidden',filter!=='all'&&card.dataset.status!==filter)})</script></body></html>\n`;
fs.writeFileSync(path.join(collectRoot, "brand-logo-review-v3.html"), review);
console.log(JSON.stringify(summary, null, 2));
