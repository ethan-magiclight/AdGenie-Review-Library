import { effectiveIndustry, effectiveProductCategory } from "./classification-fallbacks.mjs";
import { mediaLinkIsFresh } from "./media-link-freshness.mjs";
import { trustedVimeoEmbedUrl } from "./media-embed.mjs";

const app = document.querySelector("#app");

const state = {
  data: null,
  view: "matrix",
  filters: {
    industry: "all",
    query: "",
    category: "all",
    genre: "all",
    platform: "all",
    platformFormat: "all",
    aspectRatio: "all",
    recency: "all",
    sourceAccountType: "all",
    statusIds: [],
    statusMode: "include",
    classificationMode: "all",
    durationBand: "all",
    statisticsIndustryValues: null,
    statisticsCategoryValues: null,
    statisticsScopeId: null,
  },
  selectedCategory: null,
  selectedVideoId: null,
  drawerTab: "reclass",
  matrixMode: "all",
  matrixAspectRatio: "all",
  matrixScope: null,
  matrixIndustry: "all",
  matrixDimension: "industry",
  matrixView: "supply",
  fieldMenuOpen: false,
  statusFilterOpen: false,
};

const columns = [
  { id: "preview", label: "预览" },
  { id: "title", label: "标题" },
  { id: "brand", label: "品牌" },
  { id: "industry", label: "行业" },
  { id: "product_category", label: "商品品类" },
  { id: "genres", label: "题材" },
  { id: "statuses", label: "状态" },
  { id: "publish_date", label: "发布时间" },
  { id: "duration", label: "时长" },
  { id: "source_type", label: "来源" },
  { id: "source_platform", label: "平台" },
  { id: "platform_format", label: "平台形态" },
  { id: "aspect_ratio", label: "画幅" },
  { id: "source_account", label: "来源账号" },
  { id: "source_account_type", label: "账号类型" },
  { id: "quality_score", label: "视觉质量分" },
  { id: "discovery_score", label: "发现优先级" },
  { id: "collection_rule_version", label: "规则版本" },
  { id: "imported_from", label: "采集批次" },
  { id: "reason_codes", label: "原因码" },
  { id: "ai_generation_value", label: "AI 价值" },
  { id: "content_nature", label: "内容性质" },
];
const defaultVisibleColumns = ["preview", "title", "brand", "product_category", "genres", "statuses", "publish_date", "source_platform", "aspect_ratio", "quality_score"];
const missingMetadataText = "元数据缺失";
const missingMetadataTitle = "历史库缺少 YouTube metadata；需先补全发布时间和时长，再做年代/时长规则判断。";
const remakeStatusId = "needs_remake";
const mvpTargetPerMatrixCell = 10;
const pendingReviewStatusId = "pending_review";
const remadeStatusId = "remade";
const unknownIndustryFilterId = "__unknown_industry";
const unknownCategoryFilterId = "__unknown_category";
const reservedIndustryValues = new Set([
  "other",
  "unclassified",
  "跨行业 / 方法参考",
  "跨行业 / 奖项库",
]);
const workflowConclusionStatusIds = new Set(["needs_remake", "remade", "parked", "approved", "excluded", "blacklisted"]);
const statusDefinitions = {
  pending_review: {
    role: "工作队列",
    text: "已采集但还没完成最终人工判断；一旦标为需复刻、已入库、暂搁置、已排除、已拉黑或已复刻，后续保存会自动移除这个状态。",
  },
  needs_remake: {
    role: "MVP 正向结论",
    text: "质量达标、适合进入产品 MVP 模板复刻池；品类 × 题材的 MVP 缺口以这个状态为准。",
  },
  remade: {
    role: "生产完成",
    text: "已经被内容或产品团队复刻成模板；后续保存会自动移除“待审核”和“需复刻”。",
  },
  parked: {
    role: "延后处理",
    text: "有参考价值但质量、新鲜度或 AI 发挥空间不稳定；暂时不进入 MVP 复刻池。",
  },
  metadata_missing: {
    role: "事实标记",
    text: "缺少发布时间或时长等基础元数据；它不是质量结论，可与其他审核状态共存，等补齐 metadata 后再做最终规则判断。",
  },
  approved: {
    role: "历史 / 参考状态",
    text: "表示曾被认为可进入参考样片库；不等同于 MVP 必做复刻对象。当前 MVP 缺口请以“需复刻”统计为准。",
  },
  excluded: {
    role: "负向结论",
    text: "明确不符合当前样片规则，不进入模板候选；以后保存会自动移除“待审核”。",
  },
  blacklisted: {
    role: "强排除",
    text: "明确错误或未来不希望再次采集的反例；以后保存会自动移除“待审核”。",
  },
};
const mediaResolutionRequests = new Map();
const stashResolutionTimeoutMs = 20_000;

function loadVisibleColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem("adgenie.visibleColumns.v2")) || defaultVisibleColumns;
    const allowed = new Set(columns.map((column) => column.id));
    const sanitized = saved.filter((id) => allowed.has(id));
    return sanitized.length ? sanitized : defaultVisibleColumns;
  } catch {
    return defaultVisibleColumns;
  }
}

function saveVisibleColumns(ids) {
  localStorage.setItem("adgenie.visibleColumns.v2", JSON.stringify(ids));
}

let visibleColumns = loadVisibleColumns();

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function previewImage(video, className = "thumb", alt = "") {
  const fallback = video.thumbnail_url || "";
  const src = video.contact_sheet || fallback;
  if (!src) return "";
  const aspectClass = className.split(/\s+/).includes("thumb") ? ` ${previewAspectClass(video)}` : "";
  return `<img class="${escapeHtml(className)}${aspectClass}" src="${escapeHtml(src)}" data-fallback-src="${escapeHtml(fallback)}" alt="${escapeHtml(alt)}">`;
}

export function normalizedSourcePlatform(video) {
  if (video.source_platform) return String(video.source_platform).toLowerCase();
  if (video.source_site) return String(video.source_site).toLowerCase();
  return "unknown";
}

function normalizedPlatformFormat(video) {
  if (video.platform_format) return String(video.platform_format).toLowerCase();
  if (/youtube\.com\/shorts\//i.test(video.url || "")) return "shorts";
  return "unknown";
}

const formalSourcePlatformIds = new Set(["ads_of_the_world", "best_ads", "stash"]);
const taxonomyV3PreviewScopeId = "formal_three_sources_v3_preview";
const formalThreeSourceStatisticsScopes = new Set(["formal_three_sources", taxonomyV3PreviewScopeId]);

export function scopeUsesTaxonomyV3(scopeId) {
  return scopeId === taxonomyV3PreviewScopeId;
}

export function scopeUsesFormalThreeSources(scopeId) {
  return formalThreeSourceStatisticsScopes.has(scopeId);
}

export function taxonomyV3Candidate(video = {}) {
  const candidate = video?.taxonomy_v3?.candidate;
  if (!candidate || typeof candidate !== "object") return null;
  return candidate;
}

export function classificationValuesForMode(video = {}, mode = "all") {
  if (mode === "taxonomy_v3_candidate") {
    const candidate = taxonomyV3Candidate(video);
    return {
      industry: candidate?.industry || "",
      productCategory: candidate?.product_category || "",
    };
  }
  if (mode === "confirmed") {
    return {
      industry: video.industry || "",
      productCategory: video.product_category || "",
    };
  }
  return {
    industry: effectiveIndustry(video) || "",
    productCategory: effectiveProductCategory(video) || "",
  };
}

export function isFormalSourcePlatform(videoOrPlatform) {
  const platform = typeof videoOrPlatform === "string"
    ? videoOrPlatform.toLowerCase()
    : normalizedSourcePlatform(videoOrPlatform || {});
  return formalSourcePlatformIds.has(platform);
}

export function platformMatchesFilter(video, platform) {
  if (platform === "all") return true;
  if (platform === "three_sources") return isFormalSourcePlatform(video);
  return normalizedSourcePlatform(video) === platform;
}

function normalizedAspectRatio(video) {
  const value = String(video.aspect_ratio || "").trim().toLowerCase();
  if (["9:16", "16:9", "4:5", "1:1"].includes(value)) return value;
  const width = Number(video.width);
  const height = Number(video.height);
  if (width > 0 && height > 0) {
    const ratio = width / height;
    if (Math.abs(ratio - 9 / 16) < 0.08) return "9:16";
    if (Math.abs(ratio - 16 / 9) < 0.12) return "16:9";
    if (Math.abs(ratio - 4 / 5) < 0.08) return "4:5";
    if (Math.abs(ratio - 1) < 0.08) return "1:1";
  }
  if (video.is_vertical) return "9:16";
  return "unknown";
}

function sourcePlatformLabel(value) {
  return {
    youtube: "YouTube",
    tiktok: "TikTok",
    instagram: "Instagram",
    meta: "Meta",
    best_ads: "Best Ads",
    ads_of_the_world: "Ads of the World",
    stash: "STASH",
    three_sources: "三渠道开发预览",
    unknown: "未知平台",
  }[value] || value || "未知平台";
}

const platformFilterDefinitions = [
  ["all", "全部平台"],
  ["three_sources", "三渠道开发预览"],
  ["youtube", "YouTube"],
  ["tiktok", "TikTok"],
  ["instagram", "Instagram"],
  ["meta", "Meta"],
  ["best_ads", "Best Ads"],
  ["ads_of_the_world", "Ads of the World"],
  ["stash", "STASH"],
  ["unknown", "未知平台"],
];

function sourceCollectionChannel(sourceCollection, id) {
  return sourceCollection?.channels?.find((channel) => channel.id === id) || null;
}

function sourcePlatformCount(videos, platform) {
  return (videos || []).filter((video) => normalizedSourcePlatform(video) === platform).length;
}

export function platformFilterItems(videos, sourceCollection) {
  const formalCount = (videos || []).filter((video) => isFormalSourcePlatform(video)).length;
  const stashCount = sourcePlatformCount(videos, "stash");
  const stash = sourceCollectionChannel(sourceCollection, "stash");
  return platformFilterDefinitions
    .filter(([value]) => value === "all" || value === "three_sources" || sourcePlatformCount(videos, value) > 0)
    .map(([value, label]) => {
    if (value === "three_sources") return [value, `三渠道开发预览（${formalCount}）`];
    if (value !== "stash") return [value, label];
    const incomplete = stashCount === 0 && stash?.status === "trial_incomplete";
    return [value, `STASH（${stashCount}${incomplete ? " · 试采未完成" : ""}）`];
    });
}

export function emptyVideosMessage(platform, videos, sourceCollection) {
  const stashCount = sourcePlatformCount(videos, "stash");
  const stash = sourceCollectionChannel(sourceCollection, "stash");
  if (platform === "stash" && stashCount === 0 && stash?.status === "trial_incomplete") {
    const status = String(stash.status_label || "10/10 媒体解析已通过；完整试采仍未完成，暂不扩量").replace(/。+$/, "");
    return `STASH 当前 0 条可审核视频：${status}。详情见“方法论记录”。`;
  }
  return "没有符合条件的视频。";
}

function mediaProviderLabel(value) {
  return {
    youtube: "YouTube iframe",
    vimeo: "Vimeo iframe",
    mp4: "HTML5 MP4",
    hls: "HTML5 HLS",
    aotw_cdn: "AOTW CDN",
    best_ads_signed_mp4: "Best Ads signed MP4",
  }[value] || value || "未知 provider";
}

function mediaSupportsRefresh(video) {
  return video.media_provider === "best_ads_signed_mp4"
    || (video.source_site === "stash" && video.media_provider === "hls");
}

export function mediaNeedsRefresh(video) {
  return mediaSupportsRefresh(video) && !mediaLinkIsFresh(video);
}

function mediaActions(video, statusText = "") {
  const capability = video.media_download_capability || (video.media_provider === "hls"
    ? "playback_only_hls"
    : video.media_provider === "vimeo"
      ? "runtime_progressive_or_hls"
      : "direct_file");
  const stableMediaUrl = video.media_playback_url || video.media_resolver_url || "";
  const downloadUrl = video.media_download_url || "";
  const directDownload = capability === "direct_file";
  const runtimeDownload = capability === "runtime_progressive_or_hls";
  const refresh = mediaSupportsRefresh(video)
    ? `<button type="button" class="btn ghost" data-refresh-media>重新获取视频链接</button>`
    : "";
  const mediaLink = directDownload && downloadUrl
    ? `<a class="btn primary" target="_blank" rel="noreferrer" href="${escapeHtml(downloadUrl)}">获取 / 下载视频</a><button type="button" class="btn ghost" data-copy-media-link="${escapeHtml(downloadUrl)}">复制研发链接</button>`
    : stableMediaUrl
      ? `<a class="btn primary" target="_blank" rel="noreferrer" href="${escapeHtml(stableMediaUrl)}">获取当前播放地址</a><button type="button" class="btn ghost" data-copy-media-link="${escapeHtml(stableMediaUrl)}">复制播放接口</button>`
      : "";
  const downloadNote = capability === "playback_only_hls"
    ? "当前为 HLS 播放流，不提供 MP4 文件下载。"
    : runtimeDownload
      ? "Vimeo 播放地址可运行时解析；仅在源站提供 progressive MP4 时可下载。"
      : "";
  return `
    <div class="media-delivery">
      <div class="inline">
        ${mediaLink}
        ${refresh}
      </div>
      ${downloadNote ? `<p class="media-status">${escapeHtml(downloadNote)}</p>` : ""}
      <p class="media-status" data-media-status>${escapeHtml(statusText)}</p>
    </div>
  `;
}

function mediaFallback(video, hidden = false) {
  const preview = video.contact_sheet || video.thumbnail_url
    ? previewImage(video, "contact large", `${video.title || "video"} contact sheet`)
    : `<div class="empty-preview">视频当前不可播放，且暂无 Contact Sheet。</div>`;
  return `<div class="media-fallback" data-media-fallback ${hidden ? "hidden" : ""}>${preview}<a class="btn ghost" target="_blank" rel="noreferrer" href="${escapeHtml(video.source_detail_url || video.url)}">打开来源详情页</a></div>`;
}

export function renderMediaPreview(video) {
  const provider = video.media_provider || normalizedSourcePlatform(video);
  const aspectClass = previewAspectClass(video);
  const embedUrl = provider === "vimeo" ? trustedVimeoEmbedUrl(video) : video.embed_url;
  if (["youtube", "vimeo"].includes(provider) && embedUrl) {
    return `<iframe class="video-frame ${aspectClass}" src="${escapeHtml(embedUrl)}" allowfullscreen title="${escapeHtml(mediaProviderLabel(provider))} preview"></iframe>`;
  }
  if (["mp4", "hls", "aotw_cdn", "best_ads_signed_mp4"].includes(provider) && mediaLinkIsFresh(video)) {
    const type = provider === "hls" ? "application/vnd.apple.mpegurl" : "video/mp4";
    return `
      <div class="media-preview" data-media-container="${escapeHtml(video.video_id)}">
        <video class="video-frame ${aspectClass}" controls preload="metadata" poster="${escapeHtml(video.thumbnail_url || "")}" data-media-video>
          <source src="${escapeHtml(video.playback_url)}" type="${type}">
        </video>
        ${mediaFallback(video, true)}
        ${mediaActions(video, provider === "best_ads_signed_mp4"
    ? (video.media_expires_at ? `链接有效至 ${formatDateTime(video.media_expires_at)}` : "稳定 CDN 链接，可直接播放和下载。")
    : "可直接播放，也可通过稳定接口获取视频。")}
      </div>
    `;
  }
  if (mediaNeedsRefresh(video) && !video._media_resolution_error) {
    return `
      <div class="media-preview" data-media-container="${escapeHtml(video.video_id)}" data-media-needs-refresh>
        <div class="media-resolve-card"><span class="media-spinner" aria-hidden="true"></span><strong>正在刷新视频链接…</strong><p>拿到当前有效地址后会自动切换为视频；Contact Sheet 可先用于审核。</p></div>
        ${mediaFallback(video)}
        ${mediaActions(video, "正在连接来源站。")}
      </div>
    `;
  }
  return `<div class="media-preview" data-media-container="${escapeHtml(video.video_id)}">${mediaFallback(video)}${mediaActions(video, video._media_resolution_error || "视频链接暂不可用，请查看抽帧或来源详情页。")}</div>`;
}

function platformFormatLabel(value) {
  return { shorts: "Shorts", videos: "Videos", video: "Videos", reels: "Reels", feed: "Feed", unknown: "未知形态" }[value] || value || "未知形态";
}

function sourceAccountTypeLabel(value) {
  return {
    official_global: "全球官方",
    official_regional: "区域官方",
    official_product: "产品线官方",
    official: "官方账号",
    creator: "创作者",
    publisher: "媒体账号",
    unknown: "未知账号",
  }[value] || value || "未知账号";
}

function previewAspectClass(video) {
  const ratio = normalizedAspectRatio(video);
  if (ratio === "9:16") return "aspect-vertical";
  if (ratio === "4:5") return "aspect-portrait";
  if (ratio === "1:1") return "aspect-square";
  return "aspect-landscape";
}

function matchesAspectRatio(video, selected) {
  return selected === "all" || normalizedAspectRatio(video) === selected;
}

function videoAgeDays(video) {
  const value = video.published_at || video.publish_date;
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
}

function matchesRecency(video, selected) {
  const ageDays = videoAgeDays(video);
  if (selected === "all") return true;
  if (selected === "unknown") return ageDays === null;
  const maxDays = Number(selected);
  return ageDays !== null && Number.isFinite(maxDays) && ageDays <= maxDays;
}

function industryMeta(industry) {
  return state.data.industry_options_by_scope?.[state.matrixScope]?.options?.find((entry) => (entry.industry || entry.value) === industry)
    || state.data.industry_options?.options?.find((entry) => entry.industry === industry)
    || (state.data.industries || []).find((entry) => entry.industry === industry)
    || (state.data.videos || []).map(taxonomyV3Candidate).find((candidate) => candidate?.industry === industry);
}

const industryZhFallbacks = {
  "Apparel & Footwear": "服装与鞋履",
  Automotive: "汽车",
  "Bags & Accessories": "箱包与配饰",
  "Beauty & Personal Care": "美妆与个人护理",
  "Color Cosmetics": "彩妆",
  "Consumer Electronics": "消费电子",
  "Cybersecurity & Technology": "网络安全与科技",
  "Education & Digital Services": "教育与数字服务",
  "Education & Retail Services": "教育与零售服务",
  "Financial Services": "金融服务",
  "Food & Beverage": "食品与饮料",
  Fragrance: "香水",
  "Health & Pharmaceutical": "健康与医药",
  "Home & Living/Household": "家居与家庭用品",
  "Home Appliances & Living": "家用电器与生活",
  "Jewelry & Accessories": "珠宝与配饰",
  "Jewelry & Watches": "珠宝与腕表",
  Other: "其他",
  "Personal Care": "个人护理",
  "Pet Supplies": "宠物用品",
  "Retail Services": "零售服务",
  Skincare: "护肤",
  "Sports & Outdoor": "运动与户外",
  "跨行业 / 方法参考": "跨行业",
};

function industryLabel(industry) {
  if (!industry) return "Unknown / 未知行业";
  if (industry === "跨行业 / 方法参考") return "Cross-industry / 跨行业";
  const item = industryMeta(industry);
  const zh = item?.zh || item?.industry_zh || industryZhFallbacks[industry];
  return `${industry} / ${zh || "待补中文"}`;
}

function industriesForData() {
  const scopedModel = state.data.industry_options_by_scope?.[state.matrixScope];
  const model = scopedModel || state.data.industry_options;
  if (Array.isArray(model?.options)) {
    return model.options.map((item) => item.industry || item.value).filter(Boolean);
  }
  if (scopeUsesTaxonomyV3(state.matrixScope)) {
    return [...new Set((state.data.videos || []).map((video) => taxonomyV3Candidate(video)?.industry).filter(Boolean))].sort();
  }
  const fromRegistry = (state.data.industries || []).map((item) => item.industry);
  const fromVideos = (state.data.videos || []).map((video) => video.industry).filter(Boolean);
  const fromCategories = (state.data.categories || []).map((category) => category.industry).filter(Boolean);
  return [...new Set([...fromRegistry, ...fromVideos, ...fromCategories])].sort();
}

function selectedIndustry() {
  const industries = industriesForData();
  if (state.filters.industry !== "all" && industries.includes(state.filters.industry)) return state.filters.industry;
  if (industries.length === 1) return industries[0];
  return "all";
}

function formatDate(value, fallback = "—") {
  if (!value) return fallback;
  return String(value).slice(0, 10);
}

function formatDateTime(value, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function duration(value, fallback = "—") {
  if (!value) return fallback;
  const seconds = Number(value);
  const mins = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return mins ? `${mins}m ${rest}s` : `${rest}s`;
}

function durationBandForVideo(video) {
  const seconds = Number(video?.duration_seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return "duration_missing";
  if (seconds <= 30) return "duration_le_30s";
  if (seconds <= 60) return "duration_30_to_60s";
  return "duration_gt_60s";
}

function isUnknownIndustryValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized || reservedIndustryValues.has(normalized);
}

export function classificationMatches(value, selected, unknownId, options = {}) {
  if (selected === "all") return true;
  if (selected === unknownId) {
    if (typeof options.unknownPredicate === "function") return options.unknownPredicate(options.rawValue ?? value);
    return !value || String(value).trim() === "" || String(value).toLowerCase() === "unclassified";
  }
  if (Array.isArray(options.acceptedValues) && options.acceptedValues.length) {
    return options.acceptedValues.includes(value) || options.acceptedValues.includes(options.rawValue);
  }
  return value === selected;
}

function metadataMissingCell(label = missingMetadataText) {
  return `<span class="meta-missing" title="${escapeHtml(missingMetadataTitle)}">${escapeHtml(label)}</span>`;
}

function formatDateCell(value) {
  return value ? escapeHtml(formatDate(value)) : metadataMissingCell();
}

function durationCell(value) {
  return value ? escapeHtml(duration(value)) : metadataMissingCell();
}

function missingMetadataParts(video) {
  const parts = [];
  if (!video.publish_date) parts.push("发布时间");
  if (!video.duration_seconds) parts.push("时长");
  return parts;
}

function hasMissingMetadata(video) {
  return missingMetadataParts(video).length > 0;
}

function metadataNotice(video) {
  const parts = missingMetadataParts(video);
  if (!parts.length) return "";
  return `
    <div class="metadata-notice">
      <strong>待补元数据</strong>
      <span>缺少${escapeHtml(parts.join("、"))}。不要直接写“看起来很老”；先用 <code>METADATA_MISSING</code> 标记事实，补全后再判断 <code>OUTDATED_PRODUCT_OR_VISUALS</code> 或 <code>DURATION_OUT_OF_RANGE</code>。</span>
    </div>
  `;
}

function metadataReasonHint(video) {
  if (!hasMissingMetadata(video)) return "";
  return `
    <div class="reason-hint">
      <span>这条缺元数据，建议原因码先用 <code>METADATA_MISSING</code>；如果只是视觉疑似过旧，可在原因里写 <code>VISUAL_OUTDATED_SUSPECTED</code>，等补到发布时间后再做最终排除。</span>
    </div>
  `;
}

function statusMap() {
  return new Map(state.data.statuses.map((status) => [status.id, status]));
}

function videoStatuses(video) {
  const map = statusMap();
  return (video.status_ids || []).map((id) => map.get(id)).filter(Boolean);
}

function statusPills(video) {
  return videoStatuses(video).map((status) => `<span class="status-pill" style="--pill:${status.color}">${escapeHtml(status.name)}</span>`).join("");
}

function activeStatusIds() {
  const ids = Array.isArray(state.filters.statusIds) ? state.filters.statusIds : [];
  const allowed = new Set((state.data?.statuses || []).map((status) => status.id));
  return ids.filter((id) => allowed.has(id));
}

function statusFilterMode() {
  return state.filters.statusMode === "exclude" ? "exclude" : "include";
}

function statusName(id) {
  return state.data.statuses.find((status) => status.id === id)?.name || id;
}

function statusDefinition(id) {
  return statusDefinitions[id] || {
    role: "自定义状态",
    text: "团队自定义状态；不参与预置审核流转规则。",
  };
}

function normalizeWorkflowStatusIds(statusIds = []) {
  const next = new Set(statusIds);
  const hasConclusion = [...workflowConclusionStatusIds].some((id) => next.has(id));
  if (hasConclusion) next.delete(pendingReviewStatusId);
  if (next.has(remadeStatusId)) next.delete(remakeStatusId);
  return state.data.statuses
    .map((status) => status.id)
    .filter((id) => next.has(id));
}

function statusFilterLabel() {
  const ids = activeStatusIds();
  if (!ids.length) return "全部状态";
  const names = ids.map(statusName);
  const prefix = statusFilterMode() === "exclude" ? "排除：" : "包含：";
  return names.length <= 2 ? `${prefix}${names.join("、")}` : `${prefix}${names.slice(0, 2).join("、")} +${names.length - 2}`;
}

function genreMeta(english) {
  return state.data.genres.find((genre) => genre.english === english);
}

function genreLabel(english) {
  const item = genreMeta(english);
  return item ? `${item.english}<span>${item.chinese}</span>` : english;
}

function genreShort(english) {
  const item = genreMeta(english);
  return item ? item.chinese : english;
}

function genreDefinition(english) {
  return genreMeta(english)?.definition || "";
}

function categoryMeta(category) {
  const industry = selectedIndustry();
  const scopeId = state.filters.statisticsScopeId || state.matrixScope;
  const v3Row = scopeUsesTaxonomyV3(scopeId)
    ? (state.data.library_statistics?.scopes?.[scopeId]?.category_rows || []).find((entry) => (
      entry.product_category === category
      && (industry === "all" || !entry.industry || entry.industry === industry)
    ))
    : null;
  if (v3Row) return {
    industry: v3Row.industry,
    category: v3Row.product_category,
    zh: v3Row.product_category_zh,
  };
  return state.data.categories.find((entry) => entry.category === category && (industry === "all" || !entry.industry || entry.industry === industry))
    || state.data.categories.find((entry) => entry.category === category);
}

function categoryLabel(category) {
  const item = categoryMeta(category);
  return item ? `${item.category} / ${item.zh}` : category;
}

function categoryInline(category) {
  const item = categoryMeta(category);
  return item?.zh ? `${item.category} / ${item.zh}` : category;
}

function productCategoryCandidateNames(video) {
  return [...new Set([
    video.product_category_candidate,
    ...(video.product_category_candidates || []).map((candidate) =>
      typeof candidate === "string" ? candidate : candidate?.category
    ),
    video.classification_candidate?.product_category,
  ].filter(Boolean))];
}

export function categoryFilterItems(videos = [], registry = [], industry = "all", classificationMode = "all") {
  const entries = registry.filter((item) => industry === "all" || !item.industry || item.industry === industry);
  const knownCategories = new Set(registry.map((item) => item.category));
  const candidates = new Map();
  for (const video of videos) {
    const values = classificationValuesForMode(video, classificationMode);
    const videoIndustry = values.industry;
    if (industry !== "all" && videoIndustry !== industry) continue;
    const categoryValues = classificationMode === "taxonomy_v3_candidate"
      ? [values.productCategory].filter(Boolean)
      : productCategoryCandidateNames(video);
    for (const category of categoryValues) {
      if (knownCategories.has(category) || candidates.has(category)) continue;
      candidates.set(category, {
        industry: videoIndustry || null,
        category,
        zh: "待确认",
        candidate: true,
      });
    }
  }
  return [...entries, ...[...candidates.values()].sort((left, right) => left.category.localeCompare(right.category))];
}

function categoryRegistryForFilters() {
  if (state.filters.classificationMode !== "taxonomy_v3_candidate") return state.data.categories || [];
  const scopeId = state.filters.statisticsScopeId || state.matrixScope;
  const rows = state.data.library_statistics?.scopes?.[scopeId]?.category_rows || [];
  const registry = rows.map((row) => ({
    industry: row.industry || row.industry_key || null,
    category: row.product_category || row.product_category_key || null,
    zh: row.product_category_zh || "待确认",
  })).filter((item) => item.category);
  if (registry.length) return registry;
  const candidates = (state.data.videos || []).map((video) => {
    const candidate = taxonomyV3Candidate(video);
    return candidate ? {
      industry: candidate.industry || null,
      category: candidate.product_category || null,
      zh: candidate.product_category_zh || "待确认",
    } : null;
  }).filter((item) => item?.category);
  return [...new Map(candidates.map((item) => [`${item.industry || ""}::${item.category}`, item])).values()];
}

function categoryHeader(category) {
  const item = categoryMeta(category);
  return item?.zh ? `${escapeHtml(item.category)}<span>${escapeHtml(item.zh)}</span>` : escapeHtml(category);
}

function genreCandidateNames(video) {
  return [...new Set((video.genre_candidates || []).map((candidate) =>
    typeof candidate === "string" ? candidate : candidate?.genre
  ).filter(Boolean))];
}

function genreCandidateMap(video) {
  return new Map((video.genre_candidates || []).map((candidate) => {
    if (typeof candidate === "string") return [candidate, { genre: candidate }];
    return [candidate?.genre, candidate];
  }).filter(([genre]) => Boolean(genre)));
}

function reviewGenreOptions(video, industry) {
  const values = [...new Set([
    ...targetGenresForIndustry(industry),
    ...(video.genres || []),
    ...genreCandidateNames(video),
  ])];
  const order = new Map((state.data.genres || []).map((genre, index) => [genre.english, genre.order ?? index]));
  return values.sort((left, right) => (order.get(left) ?? 999) - (order.get(right) ?? 999) || left.localeCompare(right));
}

function candidateNote() {
  return `<div class="candidate-note">候选 · 待确认</div>`;
}

function bilingualTaxonomyLabel(value, zh) {
  if (!value) return "待确认";
  return zh && zh !== value ? `${value} / ${zh}` : value;
}

function taxonomyV3StatusLabel(video) {
  const status = video?.taxonomy_v3?.classification_review_status || "pending_review";
  return {
    source_verified: "来源已核验",
    visual_verified: "视觉已核验",
    human_confirmed: "人工已确认",
    candidate: "候选待确认",
    manual_review: "需人工复核",
    pending_review: "待人工确认",
  }[status] || status;
}

function taxonomyV3CandidateCell(video, dimension) {
  const candidate = taxonomyV3Candidate(video);
  if (!candidate) return null;
  const value = dimension === "industry" ? candidate?.industry : candidate?.product_category;
  const zh = dimension === "industry" ? candidate.industry_zh : candidate.product_category_zh;
  const formalValue = dimension === "industry" ? video.industry : video.product_category;
  const formalLabel = dimension === "industry" ? industryLabel(formalValue) : categoryInline(formalValue);
  const parent = dimension === "product_category" && candidate.industry
    ? `<div class="subtext">${escapeHtml(bilingualTaxonomyLabel(candidate.industry, candidate.industry_zh))}</div>`
    : "";
  return `<div class="taxonomy-v3-cell">
    <div>${escapeHtml(bilingualTaxonomyLabel(value, zh))}</div>
    <div class="taxonomy-v3-candidate-note">Taxonomy v3 候选 · ${escapeHtml(taxonomyV3StatusLabel(video))}</div>
    ${parent}
    ${formalValue ? `<div class="taxonomy-formal-value">现正式：${escapeHtml(formalLabel || formalValue)}</div>` : ""}
  </div>`;
}

function coreVideos() {
  const industry = selectedIndustry();
  return state.data.videos.filter((video) => video.core_template_eligible && !video.blacklisted && (industry === "all" || video.industry === industry));
}

function matrixSourceVideos(mode = state.matrixMode) {
  const industry = selectedIndustry();
  let videos;
  if (mode === "needs_remake") {
    videos = state.data.videos.filter((video) => !video.blacklisted && (video.status_ids || []).includes(remakeStatusId));
  } else {
    videos = coreVideos();
  }
  return videos.filter((video) => (industry === "all" || video.industry === industry) && matchesAspectRatio(video, state.matrixAspectRatio));
}

function uniqueMasterCount(videos) {
  const masters = new Set();
  for (const video of videos) masters.add(video.canonical_master_id || video.video_id);
  return masters.size;
}

function countCell(category, genre, mode = state.matrixMode) {
  const masters = new Set();
  for (const video of matrixSourceVideos(mode)) {
    if (video.product_category === category && (video.genres || []).includes(genre)) {
      masters.add(video.canonical_master_id || video.video_id);
    }
  }
  return masters.size;
}

function matrixStats(categories, targetGenres, mode = state.matrixMode) {
  const counts = [];
  for (const genre of targetGenres) {
    for (const category of categories) counts.push(countCell(category, genre, mode));
  }
  return {
    masters: uniqueMasterCount(matrixSourceVideos(mode)),
    cells: counts.length,
    achieved: counts.filter((count) => count >= mvpTargetPerMatrixCell).length,
    partial: counts.filter((count) => count > 0 && count < mvpTargetPerMatrixCell).length,
    empty: counts.filter((count) => count === 0).length,
    gap: counts.reduce((sum, count) => sum + Math.max(mvpTargetPerMatrixCell - count, 0), 0),
  };
}

function categoryTotal(category) {
  return coreVideos().filter((video) => video.product_category === category).length;
}

function categoriesForMatrix() {
  const industry = selectedIndustry();
  const priority = new Set(priorityCategoriesForIndustry(industry));
  const withSamples = new Set(coreVideos().map((video) => video.product_category));
  return state.data.categories
    .filter((item) => industry === "all" || !item.industry || item.industry === industry)
    .map((item) => item.category)
    .filter((category) => priority.has(category) || withSamples.has(category))
    .sort((a, b) => {
      const ap = priority.has(a) ? 0 : 1;
      const bp = priority.has(b) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.localeCompare(b);
    });
}

function categoriesForCurrentIndustry() {
  const industry = selectedIndustry();
  return state.data.categories.filter((item) => industry === "all" || !item.industry || item.industry === industry);
}

function targetGenresForIndustry(industry = selectedIndustry()) {
  const perIndustry = state.data.target_genres_by_industry || {};
  if (industry !== "all" && Array.isArray(perIndustry[industry]) && perIndustry[industry].length) return perIndustry[industry];
  return state.data.target_genres || [];
}

function priorityCategoriesForIndustry(industry = selectedIndustry()) {
  const perIndustry = state.data.priority_categories_by_industry || {};
  if (industry !== "all" && Array.isArray(perIndustry[industry]) && perIndustry[industry].length) return perIndustry[industry];
  return state.data.priority_categories || [];
}

function setView(view) {
  state.view = view;
  state.fieldMenuOpen = false;
  state.statusFilterOpen = false;
  render();
}

function goVideos(category = "all", genre = "all", statusId = "") {
  state.view = "videos";
  const meta = state.data.categories.find((item) => item.category === category);
  if (meta?.industry) state.filters.industry = meta.industry;
  state.filters.category = category;
  state.filters.genre = genre;
  state.filters.aspectRatio = state.matrixAspectRatio;
  state.filters.classificationMode = "all";
  state.filters.statisticsIndustryValues = null;
  state.filters.statisticsCategoryValues = null;
  state.filters.statisticsScopeId = null;
  state.filters.statusIds = statusId ? [statusId] : [];
  state.filters.statusMode = "include";
  state.statusFilterOpen = false;
  render();
}

function openThreeSourceDelivery() {
  const statisticsScopeId = scopeUsesTaxonomyV3(state.matrixScope) ? state.matrixScope : null;
  state.view = "videos";
  state.filters = {
    industry: "all",
    query: "",
    category: "all",
    genre: "all",
    platform: "three_sources",
    platformFormat: "all",
    aspectRatio: "all",
    recency: "all",
    sourceAccountType: "all",
    statusIds: [],
    statusMode: "include",
    classificationMode: statisticsScopeId ? "taxonomy_v3_candidate" : "all",
    durationBand: "all",
    statisticsIndustryValues: null,
    statisticsCategoryValues: null,
    statisticsScopeId,
  };
  state.statusFilterOpen = false;
  state.fieldMenuOpen = false;
  render();
}

function filteredVideos() {
  const query = state.filters.query.trim().toLowerCase();
  return state.data.videos.filter((video) => {
    const classification = classificationValuesForMode(video, state.filters.classificationMode);
    const industry = classification.industry;
    const productCategory = classification.productCategory;
    const taxonomyCandidate = taxonomyV3Candidate(video);
    if (state.filters.classificationMode === "taxonomy_v3_candidate" && !taxonomyCandidate) return false;
    const rawIndustry = state.filters.classificationMode === "taxonomy_v3_candidate" ? industry : video.industry || "";
    const rawProductCategory = state.filters.classificationMode === "taxonomy_v3_candidate" ? productCategory : video.product_category || "";
    if (query) {
      const hay = [
        video.title,
        video.brand,
        industry,
        productCategory,
        taxonomyCandidate?.industry_zh,
        taxonomyCandidate?.product_category_zh,
        video.industry,
        video.product_category,
        video.video_id,
        video.url,
        video.source_account,
        video.imported_from,
        ...(video.genres || []),
      ].join(" ").toLowerCase();
      if (!hay.includes(query)) return false;
    }
    if (!classificationMatches(industry, state.filters.industry, unknownIndustryFilterId, {
      rawValue: rawIndustry,
      acceptedValues: state.filters.statisticsIndustryValues,
      unknownPredicate: isUnknownIndustryValue,
    })) return false;
    if (!classificationMatches(productCategory, state.filters.category, unknownCategoryFilterId, {
      rawValue: rawProductCategory,
      acceptedValues: state.filters.statisticsCategoryValues,
    })) return false;
    if (state.filters.genre !== "all" && !(video.genres || []).includes(state.filters.genre)) return false;
    if (!platformMatchesFilter(video, state.filters.platform)) return false;
    if (state.filters.platformFormat !== "all" && normalizedPlatformFormat(video) !== state.filters.platformFormat) return false;
    if (!matchesAspectRatio(video, state.filters.aspectRatio)) return false;
    if (!matchesRecency(video, state.filters.recency)) return false;
    if (state.filters.sourceAccountType !== "all" && String(video.source_account_type || video.publisher_role || "unknown") !== state.filters.sourceAccountType) return false;
    if (state.filters.durationBand !== "all" && durationBandForVideo(video) !== state.filters.durationBand) return false;
    const statusIds = activeStatusIds();
    if (statusIds.length) {
      const hasSelectedStatus = statusIds.some((id) => (video.status_ids || []).includes(id));
      if (statusFilterMode() === "exclude" ? hasSelectedStatus : !hasSelectedStatus) return false;
    }
    return true;
  });
}

function currentReviewQueue() {
  return filteredVideos();
}

function selectedVideoIndex() {
  return currentReviewQueue().findIndex((video) => video.video_id === state.selectedVideoId);
}

function goAdjacentVideo(delta) {
  const queue = currentReviewQueue();
  if (!queue.length) return;
  const currentIndex = selectedVideoIndex();
  const baseIndex = currentIndex >= 0 ? currentIndex : delta > 0 ? -1 : 0;
  const nextIndex = Math.min(Math.max(baseIndex + delta, 0), queue.length - 1);
  state.selectedVideoId = queue[nextIndex].video_id;
  state.drawerTab = "reclass";
  render();
}

function renderShell(content) {
  const data = state.data;
  const accepted = data.videos.filter((video) => video.core_template_eligible).length;
  const pending = data.videos.filter((video) => (video.status_ids || []).includes("pending_review")).length;
  app.innerHTML = `
    <div class="app-shell">
      <aside class="side">
        <div class="brand"><div class="brand-mark">Ad<em>Genie</em></div><div class="brand-sub">Creative Library</div></div>
        <nav class="nav">
          <button class="${state.view === "matrix" ? "active" : ""}" data-view="matrix">矩阵总览 <span>⌘1</span></button>
          <button class="${state.view === "videos" ? "active" : ""}" data-view="videos">视频审核 <span>⌘2</span></button>
          <button class="${state.view === "methodology" ? "active" : ""}" data-view="methodology">方法论记录 <span>⌘3</span></button>
          <button class="${state.view === "statuses" ? "active" : ""}" data-view="statuses">状态管理 <span>⌘4</span></button>
        </nav>
        <div class="side-block">
          <p class="side-title">当前数据</p>
          <div class="small-stat"><span>视频总数</span><strong>${data.videos.length}</strong></div>
          <div class="small-stat"><span>有效样片</span><strong>${accepted}</strong></div>
          <div class="small-stat"><span>待审核</span><strong>${pending}</strong></div>
          <div class="small-stat"><span>审核记录</span><strong>${data.review_events.length}</strong></div>
        </div>
        <div class="side-block">
          <p class="side-title">方法论</p>
          <div class="small-stat"><span>Review</span><strong>${escapeHtml(data.methodology.review_version)}</strong></div>
          <div class="small-stat"><span>题材</span><strong>${data.genres.length}</strong></div>
          <div class="small-stat"><span>商品品类</span><strong>${data.categories.length}</strong></div>
        </div>
      </aside>
      <main class="main">
        ${content}
      </main>
      ${state.selectedVideoId ? renderDrawer() : ""}
    </div>
  `;
  bindGlobal();
}

function pageTop(title, subtitle, actions = "") {
  return `
    <div class="topbar">
      <div class="page-title"><h1>${title}</h1><p>${subtitle}</p></div>
      <div class="top-actions">${actions}</div>
    </div>
  `;
}

function renderGenreMatrix() {
  const industry = selectedIndustry();
  const categories = categoriesForMatrix();
  const targetGenres = targetGenresForIndustry(industry);
  const matrixMode = state.matrixMode === "needs_remake" ? "needs_remake" : "all";
  const matrixAspectOptions = [
    ["all", "全部画幅"],
    ["9:16", "9:16 竖屏"],
    ["16:9", "16:9 横屏"],
    ["4:5", "4:5 竖版"],
    ["1:1", "1:1 方形"],
    ["unknown", "画幅未知"],
  ].map(([value, label]) => `<option value="${value}" ${state.matrixAspectRatio === value ? "selected" : ""}>${label}</option>`).join("");
  const stats = matrixStats(categories, targetGenres, matrixMode);
  const modeCopy = matrixMode === "needs_remake"
    ? {
      title: "需复刻统计",
      note: "只统计状态标记为“需复刻”的非拉黑视频，按母片去重；缺口按每格 10 条计算。",
      masterLabel: "需复刻母片",
    }
    : {
      title: "全部有效样片",
      note: "绿色 ≥10，黄色有样片但不足，红色空缺。计数只取有效模板且不含拉黑。",
      masterLabel: "有效模板母片",
    };
  const matrixRows = targetGenres.map((genre) => {
    const definition = genreDefinition(genre);
    return `
      <tr>
        <td class="genre-cell" ${definition ? `data-tooltip="${escapeHtml(definition)}" aria-label="${escapeHtml(definition)}" tabindex="0"` : ""}>
          <div class="genre-title-row"><strong>${escapeHtml(genre)}</strong>${definition ? `<span class="genre-help">说明</span>` : ""}</div>
          <span>${escapeHtml(genreShort(genre))}</span>
        </td>
        ${categories.map((category) => {
          const count = countCell(category, genre, matrixMode);
          const cls = count >= 10 ? "ok" : count > 0 ? "some" : "empty";
          const gap = Math.max(mvpTargetPerMatrixCell - count, 0);
          const cellBody = matrixMode === "needs_remake"
            ? `<strong>${count}</strong><span>${gap ? `缺 ${gap}` : "达标"}</span>`
            : `${count}`;
          const gotoStatus = matrixMode === "needs_remake" ? ` data-goto-status="${remakeStatusId}"` : "";
          return `<td class="num ${cls}" data-goto-category="${escapeHtml(category)}" data-goto-genre="${escapeHtml(genre)}"${gotoStatus}>${cellBody}</td>`;
        }).join("")}
      </tr>
    `;
  }).join("");

  renderShell(`
    ${pageTop("品牌广告题材矩阵", `当前行业：${escapeHtml(industry === "all" ? "全部行业" : industryLabel(industry))}；这是原有品类 × 题材视图，供模板复刻审核使用。`, `<button class="btn primary" data-supply-matrix>返回行业供给统计</button><button class="btn ghost" data-view="videos">进入全部视频审核</button>`)}
    <div class="content">
      <div class="hero-grid">
        <div class="metric"><div class="metric-label">全部视频</div><div class="metric-value">${state.data.videos.length}</div><div class="metric-note">含已入库、已排除、待审核</div></div>
        <div class="metric"><div class="metric-label">有效模板母片</div><div class="metric-value">${coreVideos().length}</div><div class="metric-note">去除拉黑后</div></div>
        <div class="metric"><div class="metric-label">覆盖题材</div><div class="metric-value">${targetGenres.length}</div><div class="metric-note">当前行业题材集</div></div>
        <div class="metric"><div class="metric-label">可自定义状态</div><div class="metric-value">${state.data.statuses.length}</div><div class="metric-note">可增删业务状态</div></div>
      </div>
      <section class="panel">
        <div class="panel-head">
          <div><h2>品类 × 题材总览</h2><p>${modeCopy.note}</p></div>
          <div class="matrix-controls">
            ${renderIndustrySelect("matrix")}
            <select class="select matrix-aspect-select" data-matrix-aspect>${matrixAspectOptions}</select>
            <div class="view-tabs">
              <button class="${matrixMode === "all" ? "active" : ""}" data-matrix-mode="all">全部有效样片</button>
              <button class="${matrixMode === "needs_remake" ? "active" : ""}" data-matrix-mode="needs_remake">需复刻统计</button>
            </div>
          </div>
        </div>
        <div class="matrix-summary">
          <div><span>${modeCopy.masterLabel}</span><strong>${stats.masters}</strong></div>
          <div><span>达标格</span><strong>${stats.achieved} / ${stats.cells}</strong></div>
          <div><span>已有但不足</span><strong>${stats.partial}</strong></div>
          <div><span>空缺格</span><strong>${stats.empty}</strong></div>
          <div class="gap"><span>MVP 总缺口</span><strong>${stats.gap}</strong></div>
        </div>
        <div class="matrix-wrap">
          <table class="matrix">
            <thead><tr><th>题材</th>${categories.map((category) => `<th class="category-th">${categoryHeader(category)}</th>`).join("")}</tr></thead>
            <tbody>${matrixRows}</tbody>
          </table>
        </div>
      </section>
    </div>
  `);
}

const statisticsDurationBands = [
  ["duration_le_30s", "≤30s"],
  ["duration_30_to_60s", "30–60s"],
  ["duration_gt_60s", ">60s"],
  ["duration_missing", "时长缺失"],
];

const statisticsDimensionTabs = [
  ["industry", "行业总览"],
  ["category", "商品品类"],
  ["duration", "时长分布"],
];

export function statisticsRowsForDimension(stats = {}, dimension = "all") {
  if (dimension === "industry") return Array.isArray(stats.industry_rows) ? stats.industry_rows : [];
  if (dimension === "category") return Array.isArray(stats.category_rows) ? stats.category_rows : [];
  if (dimension === "duration") return Array.isArray(stats.duration_rows) ? stats.duration_rows : [];
  return Array.isArray(stats.rows) ? stats.rows : [];
}

function statisticsScope() {
  const bundle = state.data.library_statistics || {};
  const scopes = bundle.scopes || {};
  const scopeId = scopes[state.matrixScope] ? state.matrixScope : bundle.default_scope || "formal_three_sources";
  state.matrixScope = scopeId;
  return scopes[scopeId] || {
    scope: { id: scopeId, label: scopeId, source_platforms: [] },
    rows: [],
    industry_rows: [],
    category_rows: [],
    total: { record_count: 0, unique_master_count: 0 },
  };
}

function statisticsScopeVideos(scopeId) {
  const formal = new Set(["ads_of_the_world", "best_ads", "stash"]);
  return state.data.videos.filter((video) => {
    const platform = normalizedSourcePlatform(video);
    if (scopeUsesFormalThreeSources(scopeId)) return formal.has(platform);
    if (scopeId === "youtube_legacy") return platform === "youtube";
    return true;
  });
}

function statisticsRowKey(row) {
  return row.industry_key || "__unknown_industry";
}

function statisticsCategoryKey(row) {
  return row.product_category_key || "__unknown_category";
}

function statisticsIndustryLabel(row) {
  if (!row?.industry_key) return row?.industry || "待确认行业";
  return `${row.industry} / ${row.industry_zh || industryMeta(row.industry)?.zh || "待补中文"}`;
}

function statisticsCategoryLabel(row) {
  if (!row?.product_category_key) return row?.product_category || "待确认品类";
  return `${row.product_category} / ${row.product_category_zh || categoryMeta(row.product_category)?.zh || "待补中文"}`;
}

function statisticsRowMatchesIndustry(row, selected) {
  if (selected === "all") return true;
  if (selected === unknownIndustryFilterId) return !row.industry_key;
  return row.industry_key === selected || row.industry === selected;
}

function statisticsSourceCounts(scopeId) {
  const aggregate = state.data.library_statistics?.scopes?.[scopeId];
  if (aggregate?.source_breakdown) return Object.entries(aggregate.source_breakdown).sort((left, right) => right[1] - left[1]);
  const counts = new Map();
  for (const video of statisticsScopeVideos(scopeId)) {
    const platform = normalizedSourcePlatform(video);
    counts.set(platform, (counts.get(platform) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function statisticsCount(row, key) {
  return Number(row?.[key] ?? row?.duration_bands?.[key] ?? 0);
}

function statisticsDimensionValues(row, type) {
  const key = type === "industry" ? "industry" : "product_category";
  const rawKey = type === "industry" ? "industry_raw_values" : "product_category_raw_values";
  return [...new Set([
    row?.[`${key}_key`],
    row?.[key],
    ...(Array.isArray(row?.[rawKey]) ? row[rawKey] : []),
  ].filter((value) => value !== null && value !== undefined && String(value).trim() !== ""))].map(String);
}

function statisticsCell(row, key, scopeId, industryKey, categoryKey, bandOverride = null) {
  const value = statisticsCount(row, key);
  const isDuration = key.startsWith("duration_");
  const band = bandOverride ?? (isDuration ? key : "");
  const industryValues = industryKey ? statisticsDimensionValues(row, "industry") : [];
  const categoryValues = categoryKey ? statisticsDimensionValues(row, "category") : [];
  return `<td class="stat-num ${value ? "has-value" : "zero"}" data-stat-cell data-stat-scope="${escapeHtml(scopeId)}" data-stat-industry="${escapeHtml(industryKey || "")}" data-stat-category="${escapeHtml(categoryKey || "")}" data-stat-industry-label="${escapeHtml(row?.industry || "")}" data-stat-category-label="${escapeHtml(row?.product_category || "")}" data-stat-industry-values="${escapeHtml(JSON.stringify(industryValues))}" data-stat-category-values="${escapeHtml(JSON.stringify(categoryValues))}" data-stat-band="${escapeHtml(band)}" title="点击查看对应视频">${value}</td>`;
}

function statisticsMetricCell(row, key) {
  const value = statisticsCount(row, key);
  return `<td class="stat-num ${value ? "has-value" : "zero"}">${value}</td>`;
}

function statisticsClassificationReviewCount(row) {
  return statisticsCount(row, "classification_candidate_count") + statisticsCount(row, "classification_unclassified_count");
}

function statisticsIndustryFilterKey(row, grandTotal = false) {
  if (grandTotal) return "";
  return row.industry_key || unknownIndustryFilterId;
}

function statisticsIndustryRowMarkup(row, scopeId, { grandTotal = false } = {}) {
  const industryFilterKey = statisticsIndustryFilterKey(row, grandTotal);
  const lowFrequency = row.low_frequency ? `<span class="stat-flag">低频</span>` : "—";
  const label = grandTotal ? "当前范围总计" : statisticsIndustryLabel(row);
  return `<tr class="${grandTotal ? "stat-grand-total" : "stat-industry-row"}" data-stat-row data-stat-scope="${escapeHtml(scopeId)}" data-stat-industry="${escapeHtml(row.industry_key || "")}">
    <td><div class="stat-industry-name"><strong>${escapeHtml(label)}</strong>${grandTotal ? "" : `<span class="subtext">${escapeHtml(row.industry_id || "待确认键")}</span>`}</div></td>
    ${statisticsCell(row, "record_count", scopeId, industryFilterKey, "")}
    ${statisticsMetricCell(row, "unique_master_count")}
    ${statisticsMetricCell(row, "unique_deliverable_master_count")}
    ${statisticsMetricCell(row, "pending_review_count")}
    <td class="stat-num">${statisticsClassificationReviewCount(row)}</td>
    <td class="stat-num">${grandTotal ? "—" : lowFrequency}</td>
  </tr>`;
}

function statisticsCategoryRowMarkup(row, scopeId, { grandTotal = false } = {}) {
  const industryKey = row.industry_key || "";
  const categoryKey = row.product_category_key || "";
  const industryFilterKey = statisticsIndustryFilterKey(row, grandTotal);
  const categoryFilterKey = grandTotal ? "" : categoryKey || unknownCategoryFilterId;
  const lowFrequency = row.low_frequency ? `<span class="stat-flag">低频</span>` : "";
  const conflict = statisticsCount(row, "dimension_conflict_count");
  const label = grandTotal ? "当前范围总计" : statisticsCategoryLabel(row);
  return `<tr class="${grandTotal ? "stat-grand-total" : "stat-category-row"}" data-stat-row data-stat-scope="${escapeHtml(scopeId)}" data-stat-industry="${escapeHtml(industryKey)}" data-stat-category="${escapeHtml(categoryKey)}">
    <td><div class="stat-category-name"><strong>${escapeHtml(label)}</strong>${grandTotal ? "" : `<span class="subtext">${escapeHtml(row.dimension_key || "待确认键")}</span>`}</div></td>
    <td class="stat-label-cell">${grandTotal ? "—" : escapeHtml(statisticsIndustryLabel(row))}</td>
    ${statisticsCell(row, "record_count", scopeId, industryFilterKey, categoryFilterKey)}
    ${statisticsMetricCell(row, "unique_master_count")}
    ${statisticsMetricCell(row, "unique_deliverable_master_count")}
    ${statisticsMetricCell(row, "pending_review_count")}
    <td class="stat-num">${statisticsClassificationReviewCount(row)}</td>
    <td class="stat-num">${grandTotal ? "—" : conflict ? `<span class="stat-flag danger">${conflict} 冲突</span>` : "无"}</td>
    <td class="stat-num">${grandTotal ? "—" : lowFrequency || "—"}</td>
  </tr>`;
}

function statisticsDurationRowsForSelection(stats, selectedIndustryValue) {
  if (selectedIndustryValue === "all") return statisticsRowsForDimension(stats, "duration");
  const group = (stats.duration_rows_by_industry || []).find((item) => statisticsRowMatchesIndustry(item, selectedIndustryValue));
  return Array.isArray(group?.rows) ? group.rows : [];
}

function statisticsSelectedTotal(stats, selectedIndustryValue) {
  if (selectedIndustryValue === "all") return stats.total || {};
  return (stats.industry_rows || []).find((row) => statisticsRowMatchesIndustry(row, selectedIndustryValue)) || {};
}

function statisticsSourceTags(row) {
  const values = Object.entries(row?.source_breakdown || {}).sort((left, right) => right[1] - left[1]);
  return values.map(([platform, count]) => `<span class="tag">${escapeHtml(sourcePlatformLabel(platform))} ${count}</span>`).join("") || "—";
}

function statisticsDurationRowMarkup(row, scopeId, totalRecords) {
  const band = row.duration_band_key || row.duration_band_id || "";
  const percent = totalRecords > 0 ? `${((statisticsCount(row, "record_count") / totalRecords) * 100).toFixed(1)}%` : "0.0%";
  const industryFilterKey = row.industry_id ? row.industry_key || unknownIndustryFilterId : "";
  return `<tr class="stat-duration-row" data-stat-row data-stat-scope="${escapeHtml(scopeId)}" data-stat-band="${escapeHtml(band)}">
    <td><strong>${escapeHtml(row.duration_label || statisticsDurationBands.find(([key]) => key === band)?.[1] || band)}</strong><span class="subtext">${escapeHtml(band)}</span></td>
    ${statisticsCell(row, "record_count", scopeId, industryFilterKey, "", band)}
    <td class="stat-num">${percent}</td>
    ${statisticsMetricCell(row, "unique_master_count")}
    ${statisticsMetricCell(row, "unique_deliverable_master_count")}
    ${statisticsMetricCell(row, "pending_review_count")}
    <td class="stat-num">${statisticsClassificationReviewCount(row)}</td>
    <td><div class="tags">${statisticsSourceTags(row)}</div></td>
  </tr>`;
}

function statisticsDurationTotalMarkup(row, scopeId, selectedIndustryValue) {
  const grandTotal = selectedIndustryValue === "all";
  const industryFilterKey = statisticsIndustryFilterKey(row, grandTotal);
  return `<tr class="stat-grand-total">
    <td><strong>当前范围总计</strong></td>
    ${statisticsCell(row, "record_count", scopeId, industryFilterKey, "")}
    <td class="stat-num">100.0%</td>
    ${statisticsMetricCell(row, "unique_master_count")}
    ${statisticsMetricCell(row, "unique_deliverable_master_count")}
    ${statisticsMetricCell(row, "pending_review_count")}
    <td class="stat-num">${statisticsClassificationReviewCount(row)}</td>
    <td><div class="tags">${statisticsSourceTags(row)}</div></td>
  </tr>`;
}

export function statisticsExportColumns(dimension = "all") {
  const traceability = [
    "view_id", "scope_id", "scope_label", "filter_industry_id", "filter_industry_key", "filter_industry", "include_blacklisted",
    "generated_at", "statistics_version", "statistics_contract_path", "state_sha256", "taxonomy_version", "taxonomy_policy_sha256", "methodology_version",
  ];
  const metrics = [
    "record_count", "unique_master_count", "deliverable_count", "unique_deliverable_master_count", "pending_review_count", "approved_count", "core_template_eligible_count", "excluded_count", "blacklisted_count",
    "classification_confirmed_count", "classification_candidate_count", "classification_unclassified_count", "dimension_conflict_count", "canonical_mapping_count", "canonical_mapping_conflict_count", "canonical_mapping_rules", "canonical_mapping_conflicts", "source_breakdown", "low_frequency",
  ];
  const industry = ["row_type", "dimension_key", "industry_id", "industry_key", "industry", "industry_zh", "industry_classification_status", "industry_raw", "industry_raw_values", "reserved_industry_raw_values"];
  const category = [...industry, "product_category_id", "product_category_key", "product_category", "product_category_zh", "product_category_raw", "product_category_raw_values"];
  const duration = ["row_type", "dimension_key", "duration_band_id", "duration_band_key", "duration_label", "duration_order", "duration_min_exclusive_seconds", "duration_max_inclusive_seconds"];
  if (dimension === "industry") return [...traceability, ...industry, ...metrics];
  if (dimension === "category") return [...traceability, ...category, ...metrics];
  if (dimension === "duration") return [...traceability, ...duration, ...metrics];
  return [...traceability, ...category, ...duration.slice(2), ...metrics, "duration_le_30s", "duration_30_to_60s", "duration_gt_60s", "duration_missing"];
}

function delimitedValue(value, delimiter) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.includes(delimiter) || text.includes("\"") || /[\r\n]/.test(text)
    ? `"${text.replaceAll("\"", "\"\"")}"`
    : text;
}

function statisticsExportRows(stats, dimension, selectedIndustryValue) {
  if (dimension === "duration") return statisticsDurationRowsForSelection(stats, selectedIndustryValue);
  const rows = statisticsRowsForDimension(stats, dimension);
  if (selectedIndustryValue === "all" || dimension === "all") return rows;
  return rows.filter((row) => statisticsRowMatchesIndustry(row, selectedIndustryValue));
}

function statisticsIndustryFilterMetadata(stats, selectedIndustryValue) {
  if (!selectedIndustryValue || selectedIndustryValue === "all") return {};
  return (stats.industry_rows || []).find((row) => statisticsRowMatchesIndustry(row, selectedIndustryValue)) || {};
}

export function buildStatisticsExportText(stats = {}, bundle = {}, format = "csv", dimension = "all", selectedIndustryValue = "all") {
  const columns = statisticsExportColumns(dimension);
  const delimiter = format === "tsv" ? "\t" : ",";
  const scope = stats.scope || {};
  const filterIndustry = statisticsIndustryFilterMetadata(stats, selectedIndustryValue);
  const viewIds = { industry: "industry_overview", category: "product_categories", duration: "duration_distribution", all: "mixed_legacy" };
  const rows = statisticsExportRows(stats, dimension, selectedIndustryValue).map((row) => {
    const output = {
      view_id: viewIds[dimension] || dimension,
      scope_id: scope.id || "",
      scope_label: scope.label || "",
      filter_industry_id: filterIndustry.industry_id || "",
      filter_industry_key: filterIndustry.industry_key || "",
      filter_industry: filterIndustry.industry || "",
      include_blacklisted: false,
      generated_at: stats.generated_at || bundle.generated_at || "",
      statistics_version: stats.version || bundle.version || "",
      statistics_contract_path: stats.statistics_contract_path || bundle.contract_path || "",
      state_sha256: stats.state_sha256 || bundle.state_sha256 || "",
      taxonomy_version: stats.taxonomy_version || "",
      taxonomy_policy_sha256: stats.taxonomy_policy_sha256 || bundle.taxonomy_policy_sha256 || "",
      methodology_version: stats.methodology_version || "",
      ...row,
    };
    return columns.map((column) => delimitedValue(output[column], delimiter)).join(delimiter);
  });
  return [columns.join(delimiter), ...rows].join("\n");
}

function exportStatistics(format = "csv") {
  const stats = statisticsScope();
  const bundle = state.data.library_statistics || {};
  const scope = stats.scope || {};
  const dimension = state.matrixDimension || "industry";
  const selectedIndustryValue = dimension === "industry" ? "all" : state.matrixIndustry || "all";
  const content = buildStatisticsExportText(stats, bundle, format, dimension, selectedIndustryValue);
  const blob = new Blob([content], { type: format === "tsv" ? "text/tab-separated-values;charset=utf-8" : "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `adgenie-library-statistics-${dimension}-${scope.id || "scope"}.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function goStatisticsVideos(scopeId, industryKey, categoryKey, band = "", industryValues = [], categoryValues = [], industryLabelValue = "", categoryLabelValue = "") {
  const normalizedIndustryValues = Array.isArray(industryValues) ? industryValues : [];
  const normalizedCategoryValues = Array.isArray(categoryValues) ? categoryValues : [];
  const preferredIndustry = industryKey === unknownIndustryFilterId
    ? unknownIndustryFilterId
    : industryLabelValue || industryKey || "all";
  const preferredCategory = categoryKey === unknownCategoryFilterId
    ? unknownCategoryFilterId
    : categoryLabelValue || categoryKey || "all";
  state.view = "videos";
  state.matrixScope = scopeId;
  state.filters.industry = preferredIndustry;
  state.filters.category = preferredCategory;
  state.filters.durationBand = band || "all";
  state.filters.statisticsIndustryValues = normalizedIndustryValues.length ? normalizedIndustryValues : null;
  state.filters.statisticsCategoryValues = normalizedCategoryValues.length ? normalizedCategoryValues : null;
  state.filters.statisticsScopeId = scopeId;
  state.filters.classificationMode = scopeUsesTaxonomyV3(scopeId)
    ? "taxonomy_v3_candidate"
    : categoryKey && categoryKey !== unknownCategoryFilterId ? "confirmed" : "all";
  state.filters.platform = scopeUsesFormalThreeSources(scopeId) ? "three_sources" : scopeId === "youtube_legacy" ? "youtube" : "all";
  state.filters.query = "";
  state.filters.genre = "all";
  state.filters.platformFormat = "all";
  state.filters.aspectRatio = "all";
  state.filters.recency = "all";
  state.filters.sourceAccountType = "all";
  state.filters.statusIds = ["blacklisted"];
  state.filters.statusMode = "exclude";
  render();
}

function renderMatrix() {
  if (state.matrixView === "genre") return renderGenreMatrix();
  const bundle = state.data.library_statistics;
  if (!bundle?.scopes) return renderGenreMatrix();
  const stats = statisticsScope();
  const scopeId = stats.scope?.id || state.matrixScope;
  const taxonomyV3Preview = scopeUsesTaxonomyV3(scopeId);
  const validDimensions = new Set(statisticsDimensionTabs.map(([value]) => value));
  const dimension = validDimensions.has(state.matrixDimension) ? state.matrixDimension : "industry";
  state.matrixDimension = dimension;
  const selectedIndustryValue = dimension === "industry" ? "all" : state.matrixIndustry || "all";
  const industryRows = statisticsRowsForDimension(stats, "industry");
  const categoryRows = statisticsRowsForDimension(stats, "category").filter((row) => statisticsRowMatchesIndustry(row, selectedIndustryValue));
  const durationRows = statisticsDurationRowsForSelection(stats, selectedIndustryValue);
  const total = stats.total || {};
  const selectedTotal = statisticsSelectedTotal(stats, selectedIndustryValue);
  const scopeOptions = Object.values(bundle.scopes).map((item) => `<option value="${escapeHtml(item.scope?.id || "")}" ${scopeId === item.scope?.id ? "selected" : ""}>${escapeHtml(item.scope?.label || item.scope?.id || "")}</option>`).join("");
  const sourceBreakdown = statisticsSourceCounts(scopeId).map(([platform, count]) => `<span class="tag">${escapeHtml(sourcePlatformLabel(platform))} ${count}</span>`).join("");
  const optionModel = state.data.industry_options_by_scope?.[scopeId] || state.data.industry_options || {};
  const activeCount = optionModel.active?.length || 0;
  const longTailCount = optionModel.long_tail?.length || 0;
  const unknownIndustryCount = (stats.industry_rows || []).filter((row) => !row.industry_key).reduce((sum, row) => sum + statisticsCount(row, "record_count"), 0);
  const unknownCategoryCount = (stats.category_rows || []).filter((row) => !row.product_category_key).reduce((sum, row) => sum + statisticsCount(row, "record_count"), 0);
  const classificationReviewCount = statisticsCount(total, "classification_candidate_count") + statisticsCount(total, "classification_unclassified_count");
  const tabs = statisticsDimensionTabs.map(([value, label]) => `<button type="button" role="tab" aria-selected="${dimension === value ? "true" : "false"}" class="${dimension === value ? "active" : ""}" data-stat-dimension="${value}">${label}</button>`).join("");
  const dimensionCopy = {
    industry: {
      title: "行业总览",
      note: taxonomyV3Preview
        ? "每行按 Taxonomy v3 候选行业聚合；不代表正式分类或人工批准。"
        : "每行只代表一个 canonical 行业；不混入商品品类子行或时长维度。",
    },
    category: {
      title: "商品品类",
      note: taxonomyV3Preview
        ? "每行按 Taxonomy v3 候选行业 × 商品品类路径聚合；点击后按候选值进入视频。"
        : "每行只代表一个行业 × 商品品类路径；父行业仅作路径标识，不插入行业小计。",
    },
    duration: {
      title: "时长分布",
      note: "固定四个互斥区间；可按行业切换上下文，母片与可交付口径由服务端统一聚合。",
    },
  }[dimension];
  const lowFrequencyCategoryCount = categoryRows.filter((row) => row.low_frequency).length;
  const categoryConflictCount = categoryRows.filter((row) => statisticsCount(row, "dimension_conflict_count") > 0).length;
  const knownDurationCount = statisticsCount(selectedTotal, "record_count") - statisticsCount(selectedTotal, "duration_missing");
  const dimensionMeta = dimension === "industry"
    ? `<div><span>正常行业</span><strong>${activeCount}</strong></div><div><span>低频行业</span><strong>${longTailCount}</strong></div><div><span>待确认行业记录</span><strong>${unknownIndustryCount}</strong></div><div><span>源分布</span><div class="tags">${sourceBreakdown || "—"}</div></div>`
    : dimension === "category"
      ? `<div><span>品类路径</span><strong>${categoryRows.length}</strong></div><div><span>低频品类</span><strong>${lowFrequencyCategoryCount}</strong></div><div><span>父级冲突</span><strong>${categoryConflictCount}</strong></div><div><span>待确认品类记录</span><strong>${unknownCategoryCount}</strong></div>`
      : `<div><span>互斥区间</span><strong>${durationRows.length}</strong></div><div><span>已有时长</span><strong>${knownDurationCount}</strong></div><div><span>时长缺失</span><strong>${statisticsCount(selectedTotal, "duration_missing")}</strong></div><div><span>当前过滤记录</span><strong>${statisticsCount(selectedTotal, "record_count")}</strong></div>`;
  const emptyRow = (columns) => `<tr><td colspan="${columns}"><div class="muted">当前筛选没有统计行。</div></td></tr>`;
  const industryTable = `<table class="matrix supply-matrix statistics-industry-table" data-statistics-table="industry">
    <thead><tr><th>行业</th><th>记录数</th><th>canonical 母片</th><th>可交付母片</th><th>待审核</th><th>分类待确认</th><th>低频</th></tr></thead>
    <tbody>${industryRows.map((row) => statisticsIndustryRowMarkup(row, scopeId)).join("") || emptyRow(7)}</tbody>
    <tfoot>${statisticsIndustryRowMarkup(total, scopeId, { grandTotal: true })}</tfoot>
  </table>`;
  const categoryTable = `<table class="matrix supply-matrix statistics-category-table" data-statistics-table="category">
    <thead><tr><th>商品品类</th><th>父行业路径</th><th>记录数</th><th>canonical 母片</th><th>可交付母片</th><th>待审核</th><th>分类待确认</th><th>父级冲突</th><th>低频</th></tr></thead>
    <tbody>${categoryRows.map((row) => statisticsCategoryRowMarkup(row, scopeId)).join("") || emptyRow(9)}</tbody>
    <tfoot>${statisticsCategoryRowMarkup(selectedTotal, scopeId, { grandTotal: true })}</tfoot>
  </table>`;
  const durationTable = `<table class="matrix supply-matrix statistics-duration-table" data-statistics-table="duration">
    <thead><tr><th>时长区间</th><th>记录数</th><th>占比</th><th>canonical 母片</th><th>可交付母片</th><th>待审核</th><th>分类待确认</th><th>来源分布</th></tr></thead>
    <tbody>${durationRows.map((row) => statisticsDurationRowMarkup(row, scopeId, statisticsCount(selectedTotal, "record_count"))).join("") || emptyRow(8)}</tbody>
    <tfoot>${statisticsDurationTotalMarkup(selectedTotal, scopeId, selectedIndustryValue)}</tfoot>
  </table>`;
  const table = dimension === "industry" ? industryTable : dimension === "category" ? categoryTable : durationTable;

  renderShell(`
    ${pageTop("模板供给统计台", `当前范围：${escapeHtml(stats.scope?.label || scopeId)}；默认按行业查看，切换 Tab 后每张表只保留一个统计维度。`, `<button class="btn primary" data-export-statistics="csv">导出当前 Tab CSV</button><button class="btn ghost" data-export-statistics="tsv">导出当前 Tab TSV</button><button class="btn ghost" data-genre-matrix>查看题材矩阵</button><button class="btn ghost" data-three-source-delivery>三渠道视频</button>`)}
    <div class="content">
      <div class="hero-grid stats-hero-grid">
        <div class="metric"><div class="metric-label">统计记录</div><div class="metric-value">${statisticsCount(total, "record_count")}</div><div class="metric-note">当前 scope；不含拉黑记录</div></div>
        <div class="metric"><div class="metric-label">canonical 母片</div><div class="metric-value">${statisticsCount(total, "unique_master_count")}</div><div class="metric-note">按 canonical_master_id 去重</div></div>
        <div class="metric"><div class="metric-label">可交付母片</div><div class="metric-value">${statisticsCount(total, "unique_deliverable_master_count") || statisticsCount(total, "deliverable_count")}</div><div class="metric-note">媒体可用 + Contact Sheet 证据</div></div>
        <div class="metric"><div class="metric-label">分类待确认</div><div class="metric-value">${classificationReviewCount}</div><div class="metric-note">候选 ${statisticsCount(total, "classification_candidate_count")} · 未归类 ${statisticsCount(total, "classification_unclassified_count")}</div></div>
      </div>
      <section class="panel stats-panel">
        <div class="statistics-tabs" role="tablist" aria-label="统计维度">${tabs}</div>
        <div class="panel-head">
          <div><h2>${dimensionCopy.title}</h2><p>${dimensionCopy.note}</p></div>
          <div class="matrix-controls">
            <select class="select industry-select" data-stat-scope>${scopeOptions}</select>
            ${dimension === "industry" ? "" : renderIndustrySelect("matrix")}
          </div>
        </div>
        <div class="stats-meta-strip">${dimensionMeta}</div>
        <div class="stats-note">${taxonomyV3Preview ? "本表使用 Taxonomy v3 候选层；点击数字后仍以候选值筛选，正式行业与品类不会被改写。 " : ""}${unknownIndustryCount || unknownCategoryCount ? `待确认诊断：行业 ${unknownIndustryCount} 条、商品品类 ${unknownCategoryCount} 条；候选值保留为待确认，不冒充正式分类。` : "当前 scope 没有空行业或空品类记录。"} 低频阈值 ${optionModel.threshold || 10} 条 · 统计版本 ${escapeHtml(stats.version || bundle.version || "library-statistics-v1")} · 状态 SHA ${escapeHtml((stats.state_sha256 || bundle.state_sha256 || "").slice(0, 12))}…</div>
        <div class="matrix-wrap">${table}</div>
      </section>
      <section class="stats-method-note"><strong>交付口径</strong><span>默认研发范围只含 Ads of the World、Best Ads、STASH；历史 YouTube 本轮不处理。行业、商品品类、时长分别导出，统计不代表人工批准，原审核状态完整保留。规则版本：taxonomy ${escapeHtml(stats.taxonomy_version || state.data.taxonomy?.version || state.data.stats?.taxonomy_version || "—")} · methodology ${escapeHtml(stats.methodology_version || state.data.methodology?.source_collection?.version || "—")} · statistics ${escapeHtml(stats.version || "library-statistics-v1")} · 合同 ${escapeHtml(taxonomyV3Preview ? state.data.taxonomy_v3?.contract_path || "collect/adgenie-taxonomy-contract-v3.md" : stats.statistics_contract_path || bundle.contract_path || "collect/library-statistics-contract-v1.md")}。</span></section>
    </div>
  `);
}

function renderIndustrySelect(context = "videos") {
  const selectedValue = context === "matrix" ? state.matrixIndustry : state.filters.industry;
  const industries = industriesForData();
  const unknownCount = context === "matrix"
    ? (statisticsScope().industry_rows || [])
      .filter((row) => !row.industry_key)
      .reduce((sum, row) => sum + statisticsCount(row, "record_count"), 0)
    : 0;
  if (unknownCount > 0) industries.push(unknownIndustryFilterId);
  if (industries.length <= 1) return "";
  const model = state.data.industry_options_by_scope?.[state.matrixScope] || state.data.industry_options;
  const optionMeta = new Map((model?.options || []).map((item) => [item.industry || item.value, item]));
  const options = ["all", ...new Set(industries)].map((industry) => {
    if (industry === "all") return `<option value="all" ${selectedValue === "all" ? "selected" : ""}>全部行业</option>`;
    if (industry === unknownIndustryFilterId) return `<option value="${unknownIndustryFilterId}" ${selectedValue === unknownIndustryFilterId ? "selected" : ""}>待确认行业 · ${unknownCount}</option>`;
    const meta = optionMeta.get(industry);
    return `<option value="${escapeHtml(industry)}" ${selectedValue === industry ? "selected" : ""}>${escapeHtml(`${industryLabel(industry)} · ${meta?.count ?? "—"}${meta?.is_long_tail ? " · 低频" : ""}`)}</option>`;
  }).join("");
  return `<select class="select industry-select" data-industry-select="${escapeHtml(context)}">${options}</select>`;
}

function renderStatusFilter() {
  const selected = new Set(activeStatusIds());
  const mode = statusFilterMode();
  const note = !selected.size ? "未选择状态：显示全部视频。" : mode === "exclude" ? "当前会排除带有已选状态的视频。" : "当前只显示带有已选状态的视频。";
  const menu = state.statusFilterOpen ? `
    <div class="status-filter-pop">
      <div class="status-filter-head">
        <button type="button" class="${mode === "include" ? "active" : ""}" data-status-mode="include">包含已选</button>
        <button type="button" class="${mode === "exclude" ? "active" : ""}" data-status-mode="exclude">排除已选</button>
      </div>
      <div class="status-filter-actions">
        <button type="button" data-status-action="all">全选</button>
        <button type="button" data-status-action="invert">反选</button>
        <button type="button" data-status-action="clear">清空</button>
      </div>
      <div class="status-filter-list">
        ${state.data.statuses.map((status) => `
          <label class="status-filter-row">
            <input type="checkbox" data-status-toggle="${escapeHtml(status.id)}" ${selected.has(status.id) ? "checked" : ""}>
            <span class="status-dot" style="--dot:${status.color}"></span>
            <span>${escapeHtml(status.name)}</span>
          </label>
        `).join("")}
      </div>
      <p class="status-filter-note">${note}</p>
    </div>
  ` : "";
  return `
    <div class="status-filter">
      <button type="button" class="select status-filter-button ${activeStatusIds().length ? "has-selection" : ""}" data-toggle-status-filter>
        <span>${escapeHtml(statusFilterLabel())}</span>
      </button>
      ${menu}
    </div>
  `;
}

function brandGovernanceCandidate(video) {
  const id = video?.video_id || video?.id;
  return id ? state.data.brand_governance?.video_candidates?.[id] || null : null;
}

function displayableBrandLogo(candidate) {
  return candidate?.logos?.find((logo) => logo.display_allowed && logo.logo_url) || null;
}

function brandCandidateNames(candidate) {
  return (candidate?.canonical_brands || []).map((brand) => brand.name || brand.id).filter(Boolean);
}

const brandResolutionLaneLabels = {
  manual_confirmation: "需人工确认",
  safe_auto: "可安全关联候选",
  cannot_determine: "证据不足",
  no_flag: "当前规则无风险",
  not_audited: "尚未完成审计",
};

const brandRiskLabels = {
  identity_alias_group: "品牌别名待归一",
  agency_marker_contamination: "代理商值混入品牌字段",
  multi_brand_relation_unresolved: "多品牌关系未确认",
  title_brand_mismatch: "标题品牌与存储品牌不一致",
  company_suffix_brand: "公司实体与消费品牌边界待确认",
  cross_source_title_brand_conflict: "跨来源品牌冲突",
  scalar_composite_brand: "联名品牌被压成单值",
  brand_equals_campaign_title: "品牌值疑似误取 Campaign",
  role_like_brand_value: "品牌值疑似人员或职务",
};

function brandResolutionLabel(candidate) {
  return brandResolutionLaneLabels[candidate?.resolution_lane] || "品牌状态待确认";
}

function brandRiskSummary(candidate) {
  return (candidate?.risk_codes || []).map((code) => brandRiskLabels[code] || code).join("；");
}

function brandLogoUsageLabel(logo) {
  if (!logo) return "没有 Logo 候选";
  if (logo.usage_scope === "blocked") return "许可阻断";
  if (logo.approved_for_product) return "产品发布已批准";
  return "仅限内部研发预览";
}

function renderBrandCell(video) {
  const candidate = brandGovernanceCandidate(video);
  const logo = displayableBrandLogo(candidate);
  const formal = isFormalSourcePlatform(video);
  const status = candidate ? brandResolutionLabel(candidate) : formal ? "尚未完成审计" : "";
  const canonical = brandCandidateNames(candidate).join(" / ");
  return `<div class="brand-cell">
    ${logo ? `<img class="brand-logo-candidate" src="${escapeHtml(logo.logo_url)}" alt="${escapeHtml(logo.display_name)} Logo 候选">` : `<span class="brand-logo-placeholder" aria-hidden="true">${escapeHtml(String(video.brand || "?").slice(0, 1).toUpperCase())}</span>`}
    <div><strong>${escapeHtml(video.brand || "—")}</strong>${canonical && canonical !== video.brand ? `<span>${escapeHtml(canonical)}</span>` : ""}${status ? `<em class="brand-resolution ${escapeHtml(candidate?.resolution_lane || "not_audited")}">${escapeHtml(status)}</em>` : ""}</div>
  </div>`;
}

function brandGovernancePanel(video) {
  const candidate = brandGovernanceCandidate(video);
  if (!isFormalSourcePlatform(video)) return "";
  if (!candidate) {
    return `<div class="brand-governance-card pending"><strong>品牌审计：尚未完成</strong><span>当前正式品牌值为 ${escapeHtml(video.brand || "—")}；没有可用的当前状态审计结果。</span></div>`;
  }
  const logo = displayableBrandLogo(candidate);
  const blocked = (candidate.logos || []).some((item) => !item.display_allowed);
  const canonical = brandCandidateNames(candidate).join(" / ") || "尚无 canonical brand 候选";
  const riskSummary = brandRiskSummary(candidate);
  const lane = candidate.resolution_lane || "not_audited";
  const logoDownload = logo?.preview_download_url
    ? `<a class="brand-logo-download" href="${escapeHtml(logo.preview_download_url)}">下载内部候选 PNG</a>`
    : "";
  return `<div class="brand-governance-card ${escapeHtml(lane)}">
    ${logo ? `<img src="${escapeHtml(logo.logo_url)}" alt="${escapeHtml(logo.display_name)} Logo 候选">` : ""}
    <div><strong>品牌字段：${escapeHtml(brandResolutionLabel(candidate))}</strong><span>正式原值：${escapeHtml(video.brand || "—")} · canonical 候选：${escapeHtml(canonical)}</span>${riskSummary ? `<span>风险：${escapeHtml(riskSummary)}</span>` : `<span>当前规则未发现品牌字段风险；这不等于人工确认或产品批准。</span>`}<span>候选键：${escapeHtml((candidate.brand_ids || []).join(" / ") || "—")} · 映射 ${escapeHtml(candidate.mapping_status || "unmapped")} · ${escapeHtml(candidate.mapping_method || "待补映射")}</span><span>${blocked ? "Logo 因明确许可门禁不展示。" : logo ? `${escapeHtml(brandLogoUsageLabel(logo))} · 许可状态 ${escapeHtml(logo.permission_status || "not_reviewed")}` : "当前没有可展示 Logo 候选。"}</span>${logoDownload}</div>
  </div>`;
}

function taxonomyV3List(value) {
  if (Array.isArray(value)) return value.map((item) => {
    if (typeof item === "string") return item;
    return item?.message || item?.code || JSON.stringify(item);
  }).filter(Boolean);
  if (!value || typeof value !== "object") return value ? [String(value)] : [];
  return Object.entries(value).filter(([, item]) => {
    if (Array.isArray(item)) return item.length > 0;
    return Boolean(item);
  }).map(([key, item]) => `${key}: ${typeof item === "string" ? item : JSON.stringify(item)}`);
}

function taxonomyV3CandidateCard(video) {
  const taxonomy = video?.taxonomy_v3;
  const candidate = taxonomyV3Candidate(video);
  if (!taxonomy || !candidate) return "";
  const confidence = Number(taxonomy.confidence);
  const confidenceLabel = Number.isFinite(confidence)
    ? `${Math.round((confidence <= 1 ? confidence * 100 : confidence))}%`
    : "未提供";
  const evidence = taxonomyV3List(taxonomy.evidence);
  const conflicts = taxonomyV3List(taxonomy.conflicts);
  return `<section class="taxonomy-v3-card">
    <div class="taxonomy-v3-card-head">
      <div><strong>Taxonomy v3 候选</strong><span>只读预览，不是正式分类，也不代表人工批准。</span></div>
      <span class="taxonomy-v3-status ${taxonomy.manual_review_required ? "needs-review" : ""}">${escapeHtml(taxonomyV3StatusLabel(video))}</span>
    </div>
    <div class="taxonomy-v3-card-grid">
      <div><span>候选行业</span><strong>${escapeHtml(bilingualTaxonomyLabel(candidate.industry, candidate.industry_zh))}</strong></div>
      <div><span>候选商品品类</span><strong>${escapeHtml(bilingualTaxonomyLabel(candidate.product_category, candidate.product_category_zh))}</strong></div>
      <div><span>置信度</span><strong>${escapeHtml(confidenceLabel)}</strong></div>
      <div><span>人工复核</span><strong>${taxonomy.manual_review_required ? "需要" : "当前未要求"}</strong></div>
    </div>
    ${conflicts.length ? `<div class="taxonomy-v3-card-alert"><strong>冲突</strong><span>${escapeHtml(conflicts.join("；"))}</span></div>` : ""}
    <div class="taxonomy-v3-card-evidence"><strong>候选证据</strong><span>${escapeHtml(evidence.join("；") || "未提供")}</span></div>
  </section>`;
}

function renderVideos() {
  const videos = filteredVideos();
  const brandSummary = state.data.brand_governance?.summary || {};
  const taxonomyV3Preview = state.filters.classificationMode === "taxonomy_v3_candidate";
  const threeSourceDeliveryNotice = state.filters.platform === "three_sources" ? `
    <div class="metadata-notice">
      <strong>三渠道开发预览版 · ${videos.length} 条</strong>
      <span>包含 Ads of the World、Best Ads、STASH。品牌字段已审计 ${brandSummary.audited_record_count || 0}/${brandSummary.formal_record_count || 0}；映射记录 ${brandSummary.mapping_record_count || 0}，其中身份已确认品牌 ${brandSummary.identity_confirmed_brand_count || 0}、待身份复核品牌 ${brandSummary.identity_review_required_brand_count || 0}。记录级需人工确认 ${brandSummary.resolution_lane_counts?.manual_confirmation || 0}；可预览 Logo 候选 ${brandSummary.records_with_displayable_logo_candidate || 0}，产品批准 Logo ${brandSummary.records_with_product_approved_logo || 0}。候选不会写回正式品牌或伪装成批准结果。</span>
    </div>
  ` : "";
  const taxonomyV3Notice = taxonomyV3Preview ? `
    <div class="taxonomy-v3-list-notice">
      <strong>当前按 Taxonomy v3 候选筛选</strong>
      <span>行业和商品品类来自只读候选层，仅用于新版分类预览；现有正式分类、审核状态和人工纠错均未被覆盖。</span>
    </div>
  ` : "";
  const industryOptions = ["all", ...industriesForData()].map((industry) =>
    `<option value="${escapeHtml(industry)}" ${state.filters.industry === industry ? "selected" : ""}>${industry === "all" ? "全部行业" : escapeHtml(industryLabel(industry))}</option>`
  ).join("");
  const categoryRegistry = categoryRegistryForFilters();
  const categoryFilterEntries = categoryFilterItems(state.data.videos, categoryRegistry, selectedIndustry(), state.filters.classificationMode);
  const categoryOptions = [
    { category: "all", label: "全部品类" },
    ...categoryFilterEntries.map((item) => ({
      category: item.category,
      label: `${item.candidate ? "候选 · " : ""}${bilingualTaxonomyLabel(item.category, item.zh)}`,
    })),
  ].map((item) =>
    `<option value="${escapeHtml(item.category)}" ${state.filters.category === item.category ? "selected" : ""}>${escapeHtml(item.label)}</option>`
  ).join("");
  const genreOptions = ["all", ...targetGenresForIndustry()].map((genre) =>
    `<option value="${escapeHtml(genre)}" ${state.filters.genre === genre ? "selected" : ""}>${genre === "all" ? "全部题材" : escapeHtml(genreShort(genre))}</option>`
  ).join("");
  const filterOptions = (items, selected) => items.map(([value, label]) => `<option value="${escapeHtml(value)}" ${selected === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  const platformOptions = filterOptions(platformFilterItems(state.data.videos, state.data.methodology?.source_collection), state.filters.platform);
  const platformFormatOptions = filterOptions([["all", "全部平台形态"], ["shorts", "Shorts"], ["videos", "Videos"], ["reels", "Reels"], ["feed", "Feed"], ["unknown", "未知形态"]], state.filters.platformFormat);
  const aspectRatioOptions = filterOptions([["all", "全部画幅"], ["9:16", "9:16 竖屏"], ["16:9", "16:9 横屏"], ["4:5", "4:5 竖版"], ["1:1", "1:1 方形"], ["unknown", "画幅未知"]], state.filters.aspectRatio);
  const durationBandOptions = filterOptions([["all", "全部时长"], ["duration_le_30s", "≤30s"], ["duration_30_to_60s", "30–60s"], ["duration_gt_60s", ">60s"], ["duration_missing", "时长缺失"]], state.filters.durationBand);
  const recencyOptions = filterOptions([["all", "全部发布时间"], ["90", "近 90 天"], ["180", "近 180 天"], ["365", "近 1 年"], ["730", "近 2 年"], ["unknown", "日期未知"]], state.filters.recency);
  const accountTypeValues = [...new Set(state.data.videos.map((video) => String(video.source_account_type || video.publisher_role || "unknown")))].sort();
  const accountTypeOptions = filterOptions([["all", "全部账号类型"], ...accountTypeValues.map((value) => [value, sourceAccountTypeLabel(value)])], state.filters.sourceAccountType);
  const fieldMenu = state.fieldMenuOpen ? `
    <div class="field-pop">
      ${columns.map((column) => `
        <label class="check-row">
          <input type="checkbox" data-column-toggle="${column.id}" ${visibleColumns.includes(column.id) ? "checked" : ""}>
          ${escapeHtml(column.label)}
        </label>
      `).join("")}
    </div>
  ` : "";
  const tableHead = visibleColumns.map((id) => `<th>${escapeHtml(columns.find((column) => column.id === id)?.label || id)}</th>`).join("");
  const rows = videos.map((video) => `
    <tr data-video-id="${escapeHtml(video.video_id)}">
      ${visibleColumns.map((id) => `<td>${renderCell(video, id)}</td>`).join("")}
    </tr>
  `).join("");

  renderShell(`
    ${pageTop("视频审核工作台", `当前筛选 ${videos.length} 条；字段显示可自由控制。`, `
      <div class="field-menu">
        <button class="btn" data-toggle-field-menu>字段显示</button>
        ${fieldMenu}
      </div>
    `)}
    <div class="content">
      ${threeSourceDeliveryNotice}
      ${taxonomyV3Notice}
      <div class="filters">
        <select class="select" data-filter="industry">${industryOptions}</select>
        <input class="input" data-filter="query" placeholder="搜索标题、品牌、视频 ID、题材…" value="${escapeHtml(state.filters.query)}">
        <select class="select" data-filter="category">${categoryOptions}</select>
        <select class="select" data-filter="genre">${genreOptions}</select>
        <select class="select" data-filter="platform">${platformOptions}</select>
        <select class="select" data-filter="platformFormat">${platformFormatOptions}</select>
        <select class="select" data-filter="aspectRatio">${aspectRatioOptions}</select>
        <select class="select" data-filter="durationBand">${durationBandOptions}</select>
        <select class="select" data-filter="recency">${recencyOptions}</select>
        <select class="select" data-filter="sourceAccountType">${accountTypeOptions}</select>
        ${renderStatusFilter()}
        <button class="btn ghost" data-reset-filters>清空</button>
      </div>
      <div class="table-shell">
        <table class="video-table">
          <thead><tr>${tableHead}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${visibleColumns.length}"><div class="muted">${escapeHtml(emptyVideosMessage(state.filters.platform, state.data.videos, state.data.methodology?.source_collection))}</div></td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `);
}

function renderCell(video, id) {
  if (id === "preview") return previewImage(video);
  if (id === "title") {
    const sourceUrl = video.source_detail_url || video.url || "#";
    return `<div class="title-link">${escapeHtml(video.title)}</div><div class="subtext">${escapeHtml(video.video_id)} · <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(sourcePlatformLabel(normalizedSourcePlatform(video)))} ↗</a></div>`;
  }
  if (id === "brand") return renderBrandCell(video);
  if (id === "industry") {
    const v3Cell = taxonomyV3CandidateCell(video, "industry");
    if (v3Cell) return v3Cell;
    if (video.industry) return escapeHtml(industryLabel(video.industry));
    const candidate = effectiveIndustry(video);
    return candidate ? `<div>${escapeHtml(industryLabel(candidate))}</div>${candidateNote()}` : "未知行业";
  }
  if (id === "product_category") {
    const v3Cell = taxonomyV3CandidateCell(video, "product_category");
    if (v3Cell) return v3Cell;
    if (video.product_category) return `<div>${escapeHtml(categoryInline(video.product_category))}</div><div class="subtext">${escapeHtml(industryLabel(video.industry))}</div>`;
    const candidate = effectiveProductCategory(video);
    const candidateIndustry = effectiveIndustry(video);
    return candidate
      ? `<div>${escapeHtml(categoryInline(candidate))}</div>${candidateNote()}${candidateIndustry ? `<div class="subtext">${escapeHtml(industryLabel(candidateIndustry))}</div>` : ""}`
      : `<div>—</div><div class="subtext">${escapeHtml(industryLabel(video.industry))}</div>`;
  }
  if (id === "genres") {
    const genres = video.genres || [];
    if (genres.length) return `<div class="tags">${genres.map((genre) => `<span class="tag">${escapeHtml(genreShort(genre))}</span>`).join("")}</div>`;
    const candidates = genreCandidateNames(video);
    return candidates.length
      ? `<div class="tags">${candidates.map((genre) => `<span class="tag candidate-tag">${escapeHtml(genreShort(genre))}</span>`).join("")}</div>${candidateNote()}`
      : "—";
  }
  if (id === "statuses") return `<div class="tags">${statusPills(video)}</div>`;
  if (id === "publish_date") return formatDateCell(video.publish_date);
  if (id === "duration") return durationCell(video.duration_seconds);
  if (id === "source_type") return escapeHtml(video.source_type || "—");
  if (id === "source_platform") return escapeHtml(sourcePlatformLabel(normalizedSourcePlatform(video)));
  if (id === "platform_format") return escapeHtml(platformFormatLabel(normalizedPlatformFormat(video)));
  if (id === "aspect_ratio") return `<span class="format-pill ${previewAspectClass(video)}">${escapeHtml(normalizedAspectRatio(video))}</span>`;
  if (id === "source_account") return `<div>${escapeHtml(video.source_account || "—")}</div><div class="subtext">${escapeHtml(sourceAccountTypeLabel(video.source_account_type || video.publisher_role || "unknown"))}</div>`;
  if (id === "source_account_type") return escapeHtml(sourceAccountTypeLabel(video.source_account_type || video.publisher_role || "unknown"));
  if (id === "quality_score") return video.quality_score === null || video.quality_score === undefined ? "—" : `<strong>${escapeHtml(video.quality_score)}</strong>`;
  if (id === "discovery_score") return video.discovery_score === null || video.discovery_score === undefined ? "—" : escapeHtml(video.discovery_score);
  if (id === "collection_rule_version") return escapeHtml(video.collection_rule_version || "—");
  if (id === "imported_from") return escapeHtml(video.imported_from || video.collection_batch || "—");
  if (id === "reason_codes") return `<div class="tags">${(video.reason_codes || video.decision_reason_codes || []).map((code) => `<span class="tag">${escapeHtml(code)}</span>`).join("") || "—"}</div>`;
  if (id === "ai_generation_value") return escapeHtml(video.ai_generation_value || "—");
  if (id === "content_nature") return escapeHtml(video.content_nature || "—");
  return "";
}

function selectedVideo() {
  return state.data.videos.find((video) => video.video_id === state.selectedVideoId);
}

const drawerTabs = [
  ["reclass", "审核 / 纠错"],
  ["meta", "基础信息"],
  ["frames", "抽帧"],
  ["history", "审核记录"],
];

function drawerTabId(tabId) {
  return drawerTabs.some(([id]) => id === tabId) ? tabId : "reclass";
}

function drawerTabsHtml(activeTab) {
  return drawerTabs.map(([id, label]) => `
    <button type="button" class="${activeTab === id ? "active" : ""}" aria-selected="${activeTab === id ? "true" : "false"}" data-drawer-tab="${id}">${label}</button>
  `).join("");
}

function drawerTabPanel(video, activeTab = "reclass") {
  const videoIndustry = effectiveIndustry(video) || selectedIndustry();
  const videoProductCategory = effectiveProductCategory(video);
  const candidateGenres = genreCandidateMap(video);
  const reviewGenres = reviewGenreOptions(video, videoIndustry);
  const allCandidatesSelected = candidateGenres.size > 0 && [...candidateGenres.keys()].every((genre) => (video.genres || []).includes(genre));
  const genreChecks = reviewGenres.map((genre) => {
    const candidate = candidateGenres.get(genre);
    const confidence = Number(candidate?.confidence);
    const candidateLabel = candidate
      ? `<em class="genre-candidate-badge">候选${Number.isFinite(confidence) ? ` · ${Math.round(confidence * 100)}%` : ""}</em>`
      : "";
    const evidence = (candidate?.evidence || []).join("；");
    return `
    <label class="check-row genre-option ${candidate ? "is-candidate" : ""}" ${evidence ? `title="${escapeHtml(evidence)}"` : ""}>
      <input type="checkbox" name="genre" value="${escapeHtml(genre)}" ${(video.genres || []).includes(genre) ? "checked" : ""} ${candidate ? "data-genre-candidate" : ""}>
      <span>${escapeHtml(genreShort(genre))}</span>
      ${candidateLabel}
    </label>
  `;
  }).join("");
  const candidateSummary = candidateGenres.size ? `
    <div class="genre-candidate-summary">
      <div><strong>AI 预审候选</strong><p>${allCandidatesSelected ? "黄色候选已作为默认题材选中；请人工确认、删改后保存。" : "黄色项与列表一致；勾选后仍需点击“保存本条审核”才会写入。"}</p></div>
      <button type="button" class="btn ghost" data-apply-genre-candidates ${allCandidatesSelected ? "disabled" : ""}>${allCandidatesSelected ? "候选已默认选中" : "选中候选"}</button>
    </div>
  ` : `<div class="genre-candidate-summary muted"><div><strong>暂无 AI 题材候选</strong><p>请根据画面证据人工选择。</p></div></div>`;
  const categoryOptions = state.data.categories
    .filter((item) => !item.industry || item.industry === videoIndustry)
    .map((item) => `
    <option value="${escapeHtml(item.category)}" ${item.category === videoProductCategory ? "selected" : ""}>${escapeHtml(item.category)} / ${escapeHtml(item.zh)}</option>
  `).join("");
  const primaryOptions = [`<option value="">无主题材</option>`, ...reviewGenres.map((genre) => `
    <option value="${escapeHtml(genre)}" ${genre === video.primary_genre ? "selected" : ""}>${escapeHtml(genreShort(genre))}</option>
  `)].join("");
  const statusChecks = state.data.statuses.map((status) => {
    const definition = statusDefinition(status.id);
    return `
    <label class="check-row status-check-row" title="${escapeHtml(definition.text)}">
      <input type="checkbox" name="status" value="${escapeHtml(status.id)}" ${(video.status_ids || []).includes(status.id) ? "checked" : ""}>
      <span class="status-dot" style="--dot:${status.color}"></span>
      <span class="status-check-copy"><strong>${escapeHtml(status.name)}</strong><em>${escapeHtml(definition.role)}</em></span>
    </label>
  `;
  }).join("");
  const events = (video.review_events || []).concat(state.data.review_events.filter((event) => event.video_id === video.video_id)).slice(0, 20);
  const panels = {
    reclass: `
      <section class="tab-panel">
        <div class="panel-head compact">
          <div><h2>审核 / 纠错</h2><p>先确认题材标签，再标记状态；不合格直接拉黑，原因清楚就写下来。</p></div>
          <button class="btn primary" data-save-review>保存本条审核</button>
        </div>
        <div class="drawer-body review-flow">
          <div class="review-section">
            <div class="review-section-head"><span>1</span><div><strong>题材标签</strong><p>只保留画面证据成立的题材。</p></div></div>
            ${candidateSummary}
            <div class="genre-checks compact">${genreChecks}</div>
          </div>

          <details class="advanced-classification">
            <summary>高级分类：商品品类 / 主题材</summary>
            <div class="form-grid">
              <div class="form-block"><label>商品品类</label><select class="select" data-edit-category>${categoryOptions}</select></div>
              <div class="form-block"><label>主题材</label><select class="select" data-edit-primary>${primaryOptions}</select></div>
            </div>
          </details>

          <div class="review-section">
            <div class="review-section-head"><span>2</span><div><strong>状态标记</strong><p>质量好标“需复刻”，质量不稳定先“暂搁置”。</p></div></div>
            <div class="status-shortcuts">
              <button type="button" class="btn ghost" data-status-preset="needs_remake">质量好：需复刻</button>
              <button type="button" class="btn ghost" data-status-preset="parked">质量不好：暂搁置</button>
            </div>
            <div class="genre-checks status-checks">${statusChecks}</div>
          </div>

          <div class="review-section">
            <div class="review-section-head"><span>3</span><div><strong>不合格 / 原因</strong><p>拉黑、纠错和方法论线索都用这里的原因。</p></div></div>
            <div class="form-grid">
              <div class="form-block"><label>原因码</label><input class="input" data-classification-code value="${hasMissingMetadata(video) ? "METADATA_MISSING" : "MANUAL_RECLASSIFICATION"}"></div>
              <label class="check-row"><input type="checkbox" data-methodology-candidate> 记录为方法论候选线索</label>
            </div>
            ${metadataReasonHint(video)}
            <textarea class="textarea" data-classification-reason placeholder="例如：题材应改为 Feature Callout；画面太旧，待补发布时间确认；质量好，可作为复刻样片。"></textarea>
            <div class="inline review-actions">
              <button class="btn primary" data-save-review>保存本条审核</button>
              <button class="btn danger" data-blacklist>${video.blacklisted ? "取消拉黑" : "拉黑此视频"}</button>
              <button class="btn ghost" data-add-note>只记录原因</button>
            </div>
          </div>
        </div>
      </section>
    `,
    meta: `
      <section class="tab-panel">
        <div class="panel-head compact"><div><h2>基础信息</h2><p>Campaign、来源事实、候选分类与媒体状态。</p></div><a class="btn ghost" target="_blank" rel="noreferrer" href="${escapeHtml(video.source_detail_url || video.url)}">打开来源详情页</a></div>
        <div class="drawer-body">
          ${brandGovernancePanel(video)}
          ${taxonomyV3CandidateCard(video)}
          <div class="detail-grid">
            ${kv("视频 ID", video.video_id)}
            ${kv("Campaign", video.campaign_title || video.title || "—")}
            ${kv("Campaign ID", video.campaign_id || "—")}
            ${kv("品牌", video.primary_brand || video.brand || "—")}
            ${kv("全部品牌", (video.brands || []).join(" / ") || "—")}
            ${kv("行业", industryLabel(video.industry) || "—")}
            ${kv("商品品类", categoryInline(video.product_category) || "—")}
            ${kv("行业候选", video.industry_candidate || video.classification_candidate?.industry || "待确认")}
            ${kv("品类候选", video.product_category_candidate || video.classification_candidate?.product_category || "待确认")}
            ${kv("题材候选", genreCandidateNames(video).map(genreShort).join(" / ") || "待确认")}
            ${kv("分类置信度", video.classification_candidate?.confidence ?? "—")}
            ${kv("分类证据", (video.classification_candidate?.evidence || []).join("；") || "—")}
            ${kv("来源", video.source_type || "—")}
            ${kv("来源平台", sourcePlatformLabel(normalizedSourcePlatform(video)))}
            ${kv("来源分类", (video.source_categories || []).join(" / ") || "—")}
            ${kv("来源 Industry", (video.source_industries || []).join(" / ") || "—")}
            ${kv("来源 Medium", (video.source_medium_types || []).join(" / ") || "—")}
            ${kv("平台形态", platformFormatLabel(normalizedPlatformFormat(video)))}
            ${kv("来源账号", video.source_account || "—")}
            ${kv("账号类型", sourceAccountTypeLabel(video.source_account_type || video.publisher_role || "unknown"))}
            ${kv("Agency", video.agency || "—")}
            ${kv("Production", (video.production_companies || []).join(" / ") || "—")}
            ${kv("国家/地区", video.country || "—")}
            ${kv("画幅", normalizedAspectRatio(video))}
            ${kv("视频尺寸", video.width && video.height ? `${video.width} × ${video.height}` : "—")}
            ${kv("是否竖屏", video.is_vertical || ["9:16", "4:5"].includes(normalizedAspectRatio(video)) ? "是" : "否")}
            ${kv("媒体 provider", mediaProviderLabel(video.media_provider))}
            ${kv("媒体状态", video.media_access_status || "—")}
            ${kv("媒体检查时间", formatDate(video.media_checked_at))}
            ${kv("媒体失效时间", video.media_expires_at || "—")}
            ${kv("媒体失败原因", video.media_failure_reason || "—")}
            ${video.media_resolver_url ? kvLink("媒体解析接口", video.media_resolver_url, "获取当前播放链接") : ""}
            ${video.media_download_url ? kvLink(
              video.media_download_capability === "direct_file" ? "研发稳定下载接口" : "MP4 下载尝试接口",
              video.media_download_url,
              video.media_download_capability === "direct_file" ? "获取 / 下载视频" : "仅源站提供 MP4 时可用",
            ) : ""}
            ${video.media_download_capability === "playback_only_hls" ? kv("下载能力", "仅 HLS 播放，暂无 MP4 文件") : ""}
            ${kv("内容性质", video.content_nature || "—")}
            ${kv("AI 生成价值", video.ai_generation_value || "—")}
            ${kv("视觉质量分", video.quality_score ?? "—")}
            ${kv("发现优先级", video.discovery_score ?? "—")}
            ${kv("Campaign published", formatDate(video.campaign_published_at, missingMetadataText))}
            ${kv("Source uploaded", formatDate(video.source_uploaded_at, "—"))}
            ${kv("日期证据来源", video.publish_date_source || "—")}
            ${kv("日期置信度", video.publish_date_confidence || "—")}
            ${kv("年份状态", video.campaign_year_status || "—")}
            ${kv("时长", duration(video.duration_seconds, missingMetadataText))}
            ${kv("采集日期", formatDate(video.collected_at))}
            ${kv("采集批次", video.imported_from || video.collection_batch || "—")}
            ${kv("规则版本", video.collection_rule_version || "—")}
            ${kv("原因码", [...(video.reason_codes || []), ...(video.decision_reason_codes || [])].join(" / ") || "—")}
          </div>
          ${metadataNotice(video)}
          <div class="kv"><span>Campaign 描述</span><strong>${escapeHtml(video.description || "—")}</strong></div>
          <div class="kv"><span>AI 视觉预审</span><strong>${escapeHtml(video.ai_visual_pre_review?.summary || "待视觉预审")}</strong></div>
          <div class="kv"><span>审核备注</span><strong>${escapeHtml(video.visual_notes || video.note || "—")}</strong></div>
        </div>
      </section>
    `,
    frames: `
      <section class="tab-panel">
        <div class="panel-head compact"><div><h2>抽帧 Storyboard</h2><p>用于复核画面证据，不占用首屏审核空间。</p></div></div>
        <div class="drawer-body">
          ${video.contact_sheet ? previewImage(video, "contact large", "contact sheet") : `<div class="empty-preview">暂无 10 点抽帧，优先使用视频预览。</div>`}
        </div>
      </section>
    `,
    history: `
      <section class="tab-panel">
        <div class="panel-head compact"><div><h2>审核记录</h2><p>这里是未来方法论分析的原始燃料。</p></div></div>
        <div class="drawer-body history">
          ${events.length ? events.map((event) => `
            <div class="event"><strong>${escapeHtml(event.action)} · ${escapeHtml(event.reason_code || "NO_CODE")}</strong><p>${escapeHtml(event.reason_text || "无说明")}</p><p class="subtext">${escapeHtml(event.created_at || "")}${event.methodology_candidate ? " · 方法论候选" : ""}</p></div>
          `).join("") : `<div class="muted">暂无人工审核记录。</div>`}
        </div>
      </section>
    `,
  };
  return panels[drawerTabId(activeTab)] || panels.reclass;
}

function switchDrawerTab(tabId) {
  state.drawerTab = drawerTabId(tabId);
  const video = selectedVideo();
  const panel = document.querySelector("[data-drawer-tab-panel]");
  const buttons = document.querySelectorAll("[data-drawer-tab]");
  if (!video || !panel || !buttons.length) {
    render();
    return;
  }
  buttons.forEach((button) => {
    const active = button.dataset.drawerTab === state.drawerTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  panel.innerHTML = drawerTabPanel(video, state.drawerTab);
  bindDrawerPanelActions();
}

function renderDrawer() {
  const video = selectedVideo();
  if (!video) return "";
  const queue = currentReviewQueue();
  const currentIndex = selectedVideoIndex();
  const canPrev = currentIndex > 0;
  const canNext = currentIndex >= 0 && currentIndex < queue.length - 1;
  const activeTab = drawerTabId(state.drawerTab || "reclass");
  return `
    <div class="drawer">
      <div class="drawer-backdrop" data-close-drawer></div>
      <aside class="drawer-panel">
        <div class="drawer-head">
          <div><h2>${escapeHtml(video.title)}</h2><p class="subtext">${escapeHtml(video.brand)} · ${escapeHtml(categoryInline(effectiveProductCategory(video)) || "品类待确认")} · ${formatDate(video.publish_date, "日期缺失")} · ${duration(video.duration_seconds, "时长缺失")}</p></div>
          <button class="btn ghost" data-close-drawer>关闭</button>
        </div>
        <div class="drawer-body">
          <div class="review-nav">
            <button class="btn ghost" data-prev-video ${canPrev ? "" : "disabled"}>← 上一条</button>
            <div class="review-count">${currentIndex >= 0 ? `${currentIndex + 1} / ${queue.length}` : "不在当前筛选队列"}</div>
            <button class="btn ghost" data-next-video ${canNext ? "" : "disabled"}>下一条 →</button>
          </div>
          <div class="preview-single ${previewAspectClass(video)}">
            ${renderMediaPreview(video)}
          </div>
          <section class="panel review-tabs-panel">
            <div class="tabbar">
              ${drawerTabsHtml(activeTab)}
            </div>
            <div data-drawer-tab-panel>${drawerTabPanel(video, activeTab)}</div>
          </section>
        </div>
      </aside>
    </div>
  `;
}

function kv(label, value) {
  return `<div class="kv"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function kvLink(label, href, text) {
  return `<div class="kv"><span>${escapeHtml(label)}</span><strong><a target="_blank" rel="noreferrer" href="${escapeHtml(href)}">${escapeHtml(text)}</a></strong><small>${escapeHtml(href)}</small></div>`;
}

function methodologyList(items, ordered = false) {
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${(items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>`;
}

function collectionProgressMetrics(channel) {
  if (channel.id === "best_ads") return [
    ["完成列表页", channel.progress.completed_pages],
    ["候选", channel.progress.candidates],
    ["终态", channel.progress.terminal_outcomes],
    ["剩余", channel.progress.remaining_candidates],
    ["可审核", channel.progress.reviewable_total],
    ["本轮新增", channel.progress.newly_imported],
  ];
  return [
    ["扫描列表页", channel.progress.discovery_pages_scanned],
    ["发现候选", channel.progress.discovery_candidates_seen],
    ["已处理终态", channel.progress.terminal_outcomes],
    ["交接/正式", `${channel.scope.handoff_reviewable_total ?? channel.scope.target_reviewable_total ?? "—"}/${channel.scope.formal_merge_reviewable_total ?? channel.progress.reviewable_total ?? "—"}`],
    ["可审核", channel.progress.reviewable_total],
    ["本轮新增", channel.progress.selected_new_records],
  ];
}

function renderSourceCollectionMethodology() {
  const ledger = state.data.methodology?.source_collection;
  if (!ledger?.channels?.length) return "";
  const cards = ledger.channels.map((channel) => `
    <article class="collection-method-card">
      <div class="collection-method-head">
        <div><h3>${escapeHtml(channel.name)}</h3><p>${escapeHtml(channel.objective)}</p></div>
        <span class="method-status ${escapeHtml(channel.status)}">${escapeHtml(channel.status_label)}</span>
      </div>
      <div class="method-metrics">
        ${collectionProgressMetrics(channel).map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
      </div>
      <details open><summary>采集执行方案</summary>${methodologyList(channel.collection_plan, true)}</details>
      <details><summary>元数据与日期规则</summary>${methodologyList(channel.metadata_policy)}</details>
      <details><summary>质量门与排除规则</summary>${methodologyList(channel.quality_and_exclusion_rules)}</details>
      <details class="continuation-gate" open><summary>继续采集前置条件</summary><p class="subtext">续跑 checkpoint：${escapeHtml(channel.continuation.resume_from)}</p>${methodologyList(channel.continuation.before_next_run, true)}</details>
      <details><summary>审计证据</summary>${methodologyList(channel.evidence)}</details>
    </article>
  `).join("");
  return `
    <section class="panel source-methodology">
      <div class="panel-head"><div><h2>${escapeHtml(ledger.title)}</h2><p>${escapeHtml(ledger.purpose)}</p></div><span class="methodology-version">${escapeHtml(ledger.version)} · ${escapeHtml(ledger.updated_at)}</span></div>
      <div class="collection-method-grid">${cards}</div>
    </section>
  `;
}

function renderMethodology() {
  const candidateEvents = state.data.review_events.filter((event) => event.methodology_candidate);
  renderShell(`
    ${pageTop("方法论记录", "第一版只记录人工原因和规则线索，不自动沉淀；后续由 Codex 批量分析。")}
    <div class="content methodology">
      ${renderSourceCollectionMethodology()}
      <section class="panel">
        <div class="panel-head"><div><h2>人工规则线索</h2><p>来自拉黑、重归类和原因记录中勾选“方法论候选”的事件。</p></div></div>
        <div class="drawer-body history">
          ${candidateEvents.length ? candidateEvents.map((event) => `<div class="event"><strong>${escapeHtml(event.video_id)} · ${escapeHtml(event.action)} · ${escapeHtml(event.reason_code || "")}</strong><p>${escapeHtml(event.reason_text)}</p><p class="subtext">${escapeHtml(event.created_at)}</p></div>`).join("") : `<div class="muted">暂无候选线索。你在详情页勾选“记录为方法论候选线索”后会出现在这里。</div>`}
        </div>
      </section>
      <section class="doc-card"><h2>主方法论</h2><p class="muted">${escapeHtml(state.data.methodology.main_doc_path)}</p><pre>${escapeHtml(state.data.methodology.main_doc)}</pre></section>
      <section class="doc-card"><h2>消费电子专项补充</h2><p class="muted">${escapeHtml(state.data.methodology.ce_doc_path)}</p><pre>${escapeHtml(state.data.methodology.ce_doc)}</pre></section>
    </div>
  `);
}

function renderStatuses() {
  renderShell(`
    ${pageTop("状态管理", "预置状态可直接用；自定义状态可新增/删除。删除状态会从所有视频上移除。")}
    <div class="content">
      <section class="panel">
        <div class="panel-head"><div><h2>审核状态流</h2><p>这套规则只影响后续保存；不会批量改动已经标记过的视频。</p></div></div>
        <div class="drawer-body">
          <div class="status-flow">
            <div>新采集视频</div>
            <span>→</span>
            <div>待补元数据</div>
            <span>→</span>
            <div>待审核</div>
            <span>→</span>
            <div class="positive">需复刻</div>
            <span>→</span>
            <div class="positive">已复刻</div>
          </div>
          <div class="status-branches">
            <div><strong>已入库</strong><span>历史参考样片状态，不作为 MVP 缺口口径。</span></div>
            <div><strong>暂搁置</strong><span>有参考价值，但暂不进入 MVP。</span></div>
            <div><strong>已排除</strong><span>不符合当前样片规则。</span></div>
            <div><strong>已拉黑</strong><span>明确错误或未来不要再采。</span></div>
          </div>
          <p class="status-rule-note">流转规则：保存为“需复刻 / 已入库 / 暂搁置 / 已排除 / 已拉黑 / 已复刻”后，会自动移除“待审核”；保存为“已复刻”后，还会自动移除“需复刻”。“待补元数据”是事实标记，可以保留到元数据补齐为止；MVP 缺口仍以“需复刻”统计为准。</p>
        </div>
      </section>
      <section class="panel" style="margin-top:16px">
        <div class="panel-head"><div><h2>新增状态</h2><p>例如：重点参考、客户案例候选、可做模板、内容团队已看。</p></div></div>
        <div class="drawer-body">
          <div class="form-grid">
            <input class="input" data-new-status-name placeholder="状态名称">
            <input class="input" data-new-status-color type="color" value="#64748b">
          </div>
          <button class="btn primary" data-create-status>新增状态</button>
        </div>
      </section>
      <section class="panel" style="margin-top:16px">
        <div class="panel-head"><div><h2>状态列表</h2><p>系统状态保留，自定义状态可以删除。</p></div></div>
        <div class="drawer-body status-manager">
          ${state.data.statuses.map((status) => {
            const definition = statusDefinition(status.id);
            return `
            <div class="status-row">
              <div class="status-info">
                <div class="inline"><span class="status-dot" style="--dot:${status.color}"></span><strong>${escapeHtml(status.name)}</strong><span class="subtext">${escapeHtml(definition.role)} · ${status.is_system ? "系统" : "自定义"}</span></div>
                <p>${escapeHtml(definition.text)}</p>
              </div>
              ${status.is_system ? `<span class="muted">不可删除</span>` : `<button class="btn danger" data-delete-status="${escapeHtml(status.id)}">删除</button>`}
            </div>
          `;
          }).join("")}
        </div>
      </section>
    </div>
  `);
}

function bindDrawerPanelActions() {
  document.querySelectorAll("[data-save-review]").forEach((button) => button.addEventListener("click", saveReview));
  document.querySelector("[data-save-statuses]")?.addEventListener("click", saveStatuses);
  document.querySelector("[data-save-classification]")?.addEventListener("click", saveClassification);
  document.querySelector("[data-blacklist]")?.addEventListener("click", toggleBlacklist);
  document.querySelector("[data-add-note]")?.addEventListener("click", addNote);
  document.querySelectorAll("[data-status-preset]").forEach((button) => button.addEventListener("click", () => applyStatusPreset(button.dataset.statusPreset)));
  document.querySelector("[data-apply-genre-candidates]")?.addEventListener("click", (event) => {
    document.querySelectorAll("input[name=\"genre\"][data-genre-candidate]").forEach((input) => { input.checked = true; });
    event.currentTarget.textContent = "候选已选中 · 待保存";
  });
  document.querySelectorAll('input[name="status"]').forEach((input) => input.addEventListener("change", syncWorkflowStatusCheckboxes));
}

function syncWorkflowStatusCheckboxes() {
  const checked = [...document.querySelectorAll('input[name="status"]:checked')].map((input) => input.value);
  const normalized = new Set(normalizeWorkflowStatusIds(checked));
  document.querySelectorAll('input[name="status"]').forEach((input) => {
    input.checked = normalized.has(input.value);
  });
}

function bindImageFallbacks() {
  document.querySelectorAll("img[data-fallback-src]").forEach((image) => {
    image.addEventListener("error", () => {
      const fallback = image.dataset.fallbackSrc;
      if (fallback && image.getAttribute("src") !== fallback) {
        image.setAttribute("src", fallback);
        return;
      }
      image.classList.add("is-missing");
    });
  });
}

function bindMediaFallbacks() {
  document.querySelectorAll("[data-media-video]").forEach((video) => {
    video.addEventListener("error", () => {
      video.hidden = true;
      const fallback = video.parentElement?.querySelector("[data-media-fallback]");
      if (fallback) fallback.hidden = false;
      const status = video.parentElement?.querySelector("[data-media-status]");
      if (status) status.textContent = "视频加载失败，请重新获取链接；抽帧仍可用于审核。";
    });
  });
}

function replaceMediaPreview(video) {
  const container = document.querySelector("[data-media-container]");
  if (!container || container.dataset.mediaContainer !== video.video_id) return;
  container.outerHTML = renderMediaPreview(video);
  bindMediaFallbacks();
  bindMediaPreviewActions();
}

async function resolveMediaPreview(video, force = false) {
  const key = video.video_id;
  if (mediaResolutionRequests.has(key)) return mediaResolutionRequests.get(key);
  const status = document.querySelector("[data-media-status]");
  const refreshButton = document.querySelector("[data-refresh-media]");
  if (status) status.textContent = force ? "正在重新获取最新视频链接…" : "正在连接来源站…";
  if (refreshButton) refreshButton.disabled = true;
  delete video._media_resolution_error;
  const isStash = video.source_site === "stash" && video.media_provider === "hls";
  const controller = isStash ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), stashResolutionTimeoutMs) : null;
  const request = api(`/api/videos/${encodeURIComponent(key)}/media${force ? "?refresh=1" : ""}`, controller ? { signal: controller.signal } : {})
    .then((payload) => {
      Object.assign(video, {
        playback_url: payload.playback_url,
        download_url: payload.download_url,
        playback_kind: payload.playback_kind,
        download_kind: payload.download_kind,
        download_available: payload.download_available,
        media_checked_at: payload.checked_at,
        media_expires_at: payload.expires_at,
        media_access_status: payload.access_status,
      });
      delete video._media_resolution_error;
      replaceMediaPreview(video);
      return payload;
    })
    .catch((error) => {
      video.playback_url = null;
      video.download_url = null;
      video._media_resolution_error = controller?.signal.aborted
        ? `刷新失败：STASH 媒体解析超过 ${stashResolutionTimeoutMs / 1000} 秒；Contact Sheet 已保留，可稍后重试。`
        : `刷新失败：${error.message}`;
      replaceMediaPreview(video);
      return null;
    })
    .finally(() => {
      if (timeout) clearTimeout(timeout);
      mediaResolutionRequests.delete(key);
    });
  mediaResolutionRequests.set(key, request);
  return request;
}

function bindMediaPreviewActions() {
  const container = document.querySelector("[data-media-container]");
  const video = selectedVideo();
  if (!container || !video || container.dataset.mediaContainer !== video.video_id) return;
  container.querySelector("[data-refresh-media]")?.addEventListener("click", () => resolveMediaPreview(video, true));
  container.querySelector("[data-copy-media-link]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const absoluteUrl = new URL(button.dataset.copyMediaLink, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      button.textContent = "已复制研发链接";
    } catch {
      const status = container.querySelector("[data-media-status]");
      if (status) status.textContent = `复制失败，请手动复制：${absoluteUrl}`;
    }
  });
  if (container.hasAttribute("data-media-needs-refresh")) resolveMediaPreview(video);
}

function bindGlobal() {
  bindImageFallbacks();
  bindMediaFallbacks();
  bindMediaPreviewActions();
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  document.querySelector("[data-genre-matrix]")?.addEventListener("click", () => {
    state.matrixView = "genre";
    renderMatrix();
  });
  document.querySelector("[data-supply-matrix]")?.addEventListener("click", () => {
    state.matrixView = "supply";
    renderMatrix();
  });
  document.querySelector("[data-three-source-delivery]")?.addEventListener("click", openThreeSourceDelivery);
  document.querySelectorAll("[data-matrix-mode]").forEach((button) => button.addEventListener("click", () => {
    state.matrixMode = button.dataset.matrixMode;
    renderMatrix();
  }));
  document.querySelectorAll("[data-stat-dimension]").forEach((button) => button.addEventListener("click", () => {
    state.matrixDimension = button.dataset.statDimension;
    if (state.matrixDimension === "industry") state.matrixIndustry = "all";
    renderMatrix();
  }));
  document.querySelector("[data-stat-scope]")?.addEventListener("input", (event) => {
    state.matrixScope = event.target.value;
    state.matrixIndustry = "all";
    renderMatrix();
  });
  document.querySelectorAll("[data-export-statistics]").forEach((button) => button.addEventListener("click", () => exportStatistics(button.dataset.exportStatistics)));
  document.querySelectorAll("[data-stat-cell]").forEach((cell) => cell.addEventListener("click", () => {
    let industryValues = [];
    let categoryValues = [];
    try {
      industryValues = JSON.parse(cell.dataset.statIndustryValues || "[]");
      categoryValues = JSON.parse(cell.dataset.statCategoryValues || "[]");
    } catch {
      industryValues = [];
      categoryValues = [];
    }
    goStatisticsVideos(cell.dataset.statScope, cell.dataset.statIndustry, cell.dataset.statCategory, cell.dataset.statBand, industryValues, categoryValues, cell.dataset.statIndustryLabel, cell.dataset.statCategoryLabel);
  }));
  document.querySelector("[data-matrix-aspect]")?.addEventListener("input", (event) => {
    state.matrixAspectRatio = event.target.value;
    renderMatrix();
  });
  document.querySelector("[data-industry-select]")?.addEventListener("input", (event) => {
    if (event.target.dataset.industrySelect === "matrix") {
      state.matrixIndustry = event.target.value;
      renderMatrix();
    } else {
      state.filters.industry = event.target.value;
      state.filters.category = "all";
      state.filters.statisticsIndustryValues = null;
      state.filters.statisticsCategoryValues = null;
      renderVideos();
    }
  });
  document.querySelectorAll("[data-goto-category]").forEach((el) => el.addEventListener("click", () => goVideos(el.dataset.gotoCategory, el.dataset.gotoGenre, el.dataset.gotoStatus)));
  document.querySelectorAll("[data-filter]").forEach((input) => input.addEventListener("input", () => {
    state.filters[input.dataset.filter] = input.value;
    if (input.dataset.filter === "industry") {
      state.filters.category = "all";
      state.filters.statisticsIndustryValues = null;
      state.filters.statisticsCategoryValues = null;
    }
    if (input.dataset.filter === "category") state.filters.statisticsCategoryValues = null;
    renderVideos();
  }));
  document.querySelector("[data-reset-filters]")?.addEventListener("click", () => {
    state.filters = { industry: "all", query: "", category: "all", genre: "all", platform: "all", platformFormat: "all", aspectRatio: "all", recency: "all", sourceAccountType: "all", statusIds: [], statusMode: "include", durationBand: "all", classificationMode: "all", statisticsIndustryValues: null, statisticsCategoryValues: null, statisticsScopeId: null };
    state.statusFilterOpen = false;
    renderVideos();
  });
  document.querySelector("[data-toggle-field-menu]")?.addEventListener("click", () => {
    state.fieldMenuOpen = !state.fieldMenuOpen;
    state.statusFilterOpen = false;
    renderVideos();
  });
  document.querySelector("[data-toggle-status-filter]")?.addEventListener("click", () => {
    state.statusFilterOpen = !state.statusFilterOpen;
    state.fieldMenuOpen = false;
    renderVideos();
  });
  document.querySelectorAll("[data-status-mode]").forEach((button) => button.addEventListener("click", () => {
    state.filters.statusMode = button.dataset.statusMode;
    state.statusFilterOpen = true;
    renderVideos();
  }));
  document.querySelectorAll("[data-status-toggle]").forEach((box) => box.addEventListener("change", () => {
    const id = box.dataset.statusToggle;
    const ids = activeStatusIds();
    state.filters.statusIds = box.checked ? [...new Set([...ids, id])] : ids.filter((statusId) => statusId !== id);
    state.statusFilterOpen = true;
    renderVideos();
  }));
  document.querySelectorAll("[data-status-action]").forEach((button) => button.addEventListener("click", () => {
    const all = state.data.statuses.map((status) => status.id);
    const selected = new Set(activeStatusIds());
    if (button.dataset.statusAction === "all") state.filters.statusIds = all;
    if (button.dataset.statusAction === "invert") state.filters.statusIds = all.filter((id) => !selected.has(id));
    if (button.dataset.statusAction === "clear") state.filters.statusIds = [];
    state.statusFilterOpen = true;
    renderVideos();
  }));
  document.querySelectorAll("[data-column-toggle]").forEach((box) => box.addEventListener("change", () => {
    const id = box.dataset.columnToggle;
    visibleColumns = box.checked ? [...new Set([...visibleColumns, id])] : visibleColumns.filter((column) => column !== id);
    if (!visibleColumns.length) visibleColumns = ["title"];
    saveVisibleColumns(visibleColumns);
    renderVideos();
  }));
  document.querySelectorAll("[data-video-id]").forEach((row) => row.addEventListener("click", () => {
    state.selectedVideoId = row.dataset.videoId;
    state.drawerTab = "reclass";
    render();
  }));
  document.querySelectorAll("[data-close-drawer]").forEach((el) => el.addEventListener("click", () => {
    state.selectedVideoId = null;
    render();
  }));
  document.querySelectorAll("[data-drawer-tab]").forEach((button) => button.addEventListener("click", () => {
    switchDrawerTab(button.dataset.drawerTab);
  }));
  document.querySelector("[data-prev-video]")?.addEventListener("click", () => goAdjacentVideo(-1));
  document.querySelector("[data-next-video]")?.addEventListener("click", () => goAdjacentVideo(1));
  bindDrawerPanelActions();
  document.querySelector("[data-create-status]")?.addEventListener("click", createStatus);
  document.querySelectorAll("[data-delete-status]").forEach((button) => button.addEventListener("click", () => deleteStatus(button.dataset.deleteStatus)));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function replaceVideo(video) {
  const index = state.data.videos.findIndex((item) => item.video_id === video.video_id);
  if (index >= 0) state.data.videos[index] = video;
}

function mergeEvent(event) {
  if (!event) return;
  state.data.review_events.unshift(event);
}

function sameStringSet(left = [], right = []) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function readReviewForm() {
  const checkedStatusIds = [...document.querySelectorAll('input[name="status"]:checked')].map((input) => input.value);
  return {
    product_category: document.querySelector("[data-edit-category]")?.value || selectedVideo()?.product_category,
    primary_genre: document.querySelector("[data-edit-primary]")?.value || "",
    genres: [...document.querySelectorAll('input[name="genre"]:checked')].map((input) => input.value),
    status_ids: normalizeWorkflowStatusIds(checkedStatusIds),
    reason_code: document.querySelector("[data-classification-code]")?.value || "MANUAL_REVIEW",
    reason_text: document.querySelector("[data-classification-reason]")?.value || "",
    methodology_candidate: Boolean(document.querySelector("[data-methodology-candidate]")?.checked),
  };
}

async function saveStatuses() {
  const video = selectedVideo();
  const status_ids = normalizeWorkflowStatusIds([...document.querySelectorAll('input[name="status"]:checked')].map((input) => input.value));
  const reason_text = document.querySelector("[data-status-reason]")?.value || document.querySelector("[data-classification-reason]")?.value || "";
  const payload = await api(`/api/videos/${video.video_id}/statuses`, { method: "POST", body: JSON.stringify({ status_ids, reason_text }) });
  replaceVideo(payload.video);
  mergeEvent(payload.event);
  render();
}

async function saveClassification() {
  const video = selectedVideo();
  const { product_category, primary_genre, genres, reason_code, reason_text, methodology_candidate } = readReviewForm();
  const payload = await api(`/api/videos/${video.video_id}/classification`, {
    method: "POST",
    body: JSON.stringify({ product_category, primary_genre, genres, reason_code, reason_text, methodology_candidate }),
  });
  replaceVideo(payload.video);
  mergeEvent(payload.event);
  render();
}

async function saveReview() {
  const video = selectedVideo();
  const form = readReviewForm();
  const classificationChanged =
    form.product_category !== video.product_category ||
    form.primary_genre !== (video.primary_genre || "") ||
    !sameStringSet(form.genres, video.genres || []);
  const statusChanged = !sameStringSet(form.status_ids, video.status_ids || []);
  let latestVideo = video;
  let saved = false;

  if (classificationChanged) {
    const payload = await api(`/api/videos/${video.video_id}/classification`, {
      method: "POST",
      body: JSON.stringify({
        product_category: form.product_category,
        primary_genre: form.primary_genre,
        genres: form.genres,
        reason_code: form.reason_code,
        reason_text: form.reason_text,
        methodology_candidate: form.methodology_candidate,
      }),
    });
    latestVideo = payload.video;
    replaceVideo(payload.video);
    mergeEvent(payload.event);
    saved = true;
  }

  if (statusChanged) {
    const payload = await api(`/api/videos/${latestVideo.video_id}/statuses`, {
      method: "POST",
      body: JSON.stringify({ status_ids: form.status_ids, reason_text: form.reason_text }),
    });
    replaceVideo(payload.video);
    mergeEvent(payload.event);
    saved = true;
  }

  if (!saved && form.reason_text.trim()) {
    const payload = await api(`/api/videos/${video.video_id}/review`, {
      method: "POST",
      body: JSON.stringify({
        action: "note",
        reason_code: form.reason_code,
        reason_text: form.reason_text,
        methodology_candidate: form.methodology_candidate,
      }),
    });
    replaceVideo(payload.video);
    mergeEvent(payload.event);
  }

  render();
}

function applyStatusPreset(statusId) {
  const target = [...document.querySelectorAll('input[name="status"]')].find((input) => input.value === statusId);
  if (!target) return;
  target.checked = true;
  const pending = document.querySelector(`input[name="status"][value="${pendingReviewStatusId}"]`);
  if (pending && workflowConclusionStatusIds.has(statusId)) pending.checked = false;
  if (statusId === "needs_remake") {
    const parked = document.querySelector('input[name="status"][value="parked"]');
    if (parked) parked.checked = false;
  }
  if (statusId === "parked") {
    const needsRemake = document.querySelector('input[name="status"][value="needs_remake"]');
    if (needsRemake) needsRemake.checked = false;
  }
  if (statusId === remadeStatusId) {
    const needsRemake = document.querySelector(`input[name="status"][value="${remakeStatusId}"]`);
    if (needsRemake) needsRemake.checked = false;
  }
}

async function toggleBlacklist() {
  const video = selectedVideo();
  const form = readReviewForm();
  const reason_code = form.reason_code || "MANUAL_BLACKLIST";
  const reason_text = form.reason_text;
  const methodology_candidate = form.methodology_candidate;
  const payload = await api(`/api/videos/${video.video_id}/blacklist`, {
    method: "POST",
    body: JSON.stringify({ blacklisted: !video.blacklisted, reason_code, reason_text, methodology_candidate }),
  });
  replaceVideo(payload.video);
  mergeEvent(payload.event);
  render();
}

async function addNote() {
  const video = selectedVideo();
  const form = readReviewForm();
  const reason_code = form.reason_code || "MANUAL_NOTE";
  const reason_text = form.reason_text;
  const methodology_candidate = form.methodology_candidate;
  const payload = await api(`/api/videos/${video.video_id}/review`, {
    method: "POST",
    body: JSON.stringify({ action: "note", reason_code, reason_text, methodology_candidate }),
  });
  replaceVideo(payload.video);
  mergeEvent(payload.event);
  render();
}

async function createStatus() {
  const name = document.querySelector("[data-new-status-name]").value.trim();
  const color = document.querySelector("[data-new-status-color]").value;
  if (!name) return;
  const status = await api("/api/statuses", { method: "POST", body: JSON.stringify({ name, color }) });
  if (!state.data.statuses.find((item) => item.id === status.id)) state.data.statuses.push(status);
  renderStatuses();
}

async function deleteStatus(id) {
  if (!confirm("删除这个自定义状态？它会从所有视频上移除。")) return;
  await api(`/api/statuses/${id}`, { method: "DELETE" });
  state.data.statuses = state.data.statuses.filter((status) => status.id !== id);
  for (const video of state.data.videos) video.status_ids = (video.status_ids || []).filter((statusId) => statusId !== id);
  renderStatuses();
}

function render() {
  if (state.view === "videos") return renderVideos();
  if (state.view === "methodology") return renderMethodology();
  if (state.view === "statuses") return renderStatuses();
  return renderMatrix();
}

async function boot() {
  try {
    const data = await api("/api/bootstrap");
    state.data = data;
    render();
  } catch (error) {
    app.innerHTML = `<div class="boot danger-text">加载失败：${escapeHtml(error.message)}<br>请先在 web 目录运行 <code>npm run import</code>。</div>`;
  }
}

if (typeof window !== "undefined") boot();
