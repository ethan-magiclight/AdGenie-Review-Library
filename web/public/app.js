const app = document.querySelector("#app");

const state = {
  data: null,
  view: "matrix",
  filters: {
    query: "",
    category: "all",
    genre: "all",
    statusIds: [],
    statusMode: "include",
  },
  selectedCategory: null,
  selectedVideoId: null,
  drawerTab: "reclass",
  matrixMode: "all",
  fieldMenuOpen: false,
  statusFilterOpen: false,
};

const columns = [
  { id: "preview", label: "预览" },
  { id: "title", label: "标题" },
  { id: "brand", label: "品牌" },
  { id: "product_category", label: "商品品类" },
  { id: "genres", label: "题材" },
  { id: "statuses", label: "状态" },
  { id: "publish_date", label: "发布时间" },
  { id: "duration", label: "时长" },
  { id: "source_type", label: "来源" },
  { id: "reason_codes", label: "原因码" },
  { id: "ai_generation_value", label: "AI 价值" },
  { id: "content_nature", label: "内容性质" },
];
const defaultVisibleColumns = ["preview", "title", "brand", "product_category", "genres", "statuses", "publish_date", "duration"];
const missingMetadataText = "元数据缺失";
const missingMetadataTitle = "历史库缺少 YouTube metadata；需先补全发布时间和时长，再做年代/时长规则判断。";
const remakeStatusId = "needs_remake";
const mvpTargetPerMatrixCell = 10;
const pendingReviewStatusId = "pending_review";
const remadeStatusId = "remade";
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

function loadVisibleColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem("adgenie.visibleColumns")) || defaultVisibleColumns;
    const allowed = new Set(columns.map((column) => column.id));
    const sanitized = saved.filter((id) => allowed.has(id));
    return sanitized.length ? sanitized : defaultVisibleColumns;
  } catch {
    return defaultVisibleColumns;
  }
}

function saveVisibleColumns(ids) {
  localStorage.setItem("adgenie.visibleColumns", JSON.stringify(ids));
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
  return `<img class="${escapeHtml(className)}" src="${escapeHtml(src)}" data-fallback-src="${escapeHtml(fallback)}" alt="${escapeHtml(alt)}">`;
}

function formatDate(value, fallback = "—") {
  if (!value) return fallback;
  return String(value).slice(0, 10);
}

function duration(value, fallback = "—") {
  if (!value) return fallback;
  const seconds = Number(value);
  const mins = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return mins ? `${mins}m ${rest}s` : `${rest}s`;
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
  return state.data.categories.find((entry) => entry.category === category);
}

function categoryLabel(category) {
  const item = categoryMeta(category);
  return item ? `${item.category} / ${item.zh}` : category;
}

function categoryInline(category) {
  const item = categoryMeta(category);
  return item?.zh ? `${item.category} / ${item.zh}` : category;
}

function categoryHeader(category) {
  const item = categoryMeta(category);
  return item?.zh ? `${escapeHtml(item.category)}<span>${escapeHtml(item.zh)}</span>` : escapeHtml(category);
}

function coreVideos() {
  return state.data.videos.filter((video) => video.core_template_eligible && !video.blacklisted);
}

function matrixSourceVideos(mode = state.matrixMode) {
  if (mode === "needs_remake") {
    return state.data.videos.filter((video) => !video.blacklisted && (video.status_ids || []).includes(remakeStatusId));
  }
  return coreVideos();
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
  const priority = new Set(state.data.priority_categories || []);
  const withSamples = new Set(coreVideos().map((video) => video.product_category));
  return state.data.categories
    .map((item) => item.category)
    .filter((category) => priority.has(category) || withSamples.has(category))
    .sort((a, b) => {
      const ap = priority.has(a) ? 0 : 1;
      const bp = priority.has(b) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.localeCompare(b);
    });
}

function setView(view) {
  state.view = view;
  state.fieldMenuOpen = false;
  state.statusFilterOpen = false;
  render();
}

function goVideos(category = "all", genre = "all", statusId = "") {
  state.view = "videos";
  state.filters.category = category;
  state.filters.genre = genre;
  state.filters.statusIds = statusId ? [statusId] : [];
  state.filters.statusMode = "include";
  state.statusFilterOpen = false;
  render();
}

function filteredVideos() {
  const query = state.filters.query.trim().toLowerCase();
  return state.data.videos.filter((video) => {
    if (query) {
      const hay = [video.title, video.brand, video.product_category, video.video_id, video.url, ...(video.genres || [])].join(" ").toLowerCase();
      if (!hay.includes(query)) return false;
    }
    if (state.filters.category !== "all" && video.product_category !== state.filters.category) return false;
    if (state.filters.genre !== "all" && !(video.genres || []).includes(state.filters.genre)) return false;
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

function renderMatrix() {
  const categories = categoriesForMatrix();
  const targetGenres = state.data.target_genres;
  const matrixMode = state.matrixMode === "needs_remake" ? "needs_remake" : "all";
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
    ${pageTop("品牌广告样片矩阵", "按商品品类 × 广告题材查看模板供给；数字可点击进入审核列表。", `<button class="btn primary" data-view="videos">进入视频审核</button>`)}
    <div class="content">
      <div class="hero-grid">
        <div class="metric"><div class="metric-label">全部视频</div><div class="metric-value">${state.data.videos.length}</div><div class="metric-note">含已入库、已排除、待审核</div></div>
        <div class="metric"><div class="metric-label">有效模板母片</div><div class="metric-value">${coreVideos().length}</div><div class="metric-note">去除拉黑后</div></div>
        <div class="metric"><div class="metric-label">覆盖题材</div><div class="metric-value">${state.data.target_genres.length}</div><div class="metric-note">MVP 当前题材集</div></div>
        <div class="metric"><div class="metric-label">可自定义状态</div><div class="metric-value">${state.data.statuses.length}</div><div class="metric-note">可增删业务状态</div></div>
      </div>
      <section class="panel">
        <div class="panel-head">
          <div><h2>品类 × 题材总览</h2><p>${modeCopy.note}</p></div>
          <div class="view-tabs">
            <button class="${matrixMode === "all" ? "active" : ""}" data-matrix-mode="all">全部有效样片</button>
            <button class="${matrixMode === "needs_remake" ? "active" : ""}" data-matrix-mode="needs_remake">需复刻统计</button>
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

function renderVideos() {
  const videos = filteredVideos();
  const categoryOptions = ["all", ...state.data.categories.map((item) => item.category)].map((category) =>
    `<option value="${escapeHtml(category)}" ${state.filters.category === category ? "selected" : ""}>${category === "all" ? "全部品类" : escapeHtml(categoryInline(category))}</option>`
  ).join("");
  const genreOptions = ["all", ...state.data.target_genres].map((genre) =>
    `<option value="${escapeHtml(genre)}" ${state.filters.genre === genre ? "selected" : ""}>${genre === "all" ? "全部题材" : escapeHtml(genreShort(genre))}</option>`
  ).join("");
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
      <div class="filters">
        <input class="input" data-filter="query" placeholder="搜索标题、品牌、视频 ID、题材…" value="${escapeHtml(state.filters.query)}">
        <select class="select" data-filter="category">${categoryOptions}</select>
        <select class="select" data-filter="genre">${genreOptions}</select>
        ${renderStatusFilter()}
        <button class="btn ghost" data-reset-filters>清空</button>
      </div>
      <div class="table-shell">
        <table class="video-table">
          <thead><tr>${tableHead}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${visibleColumns.length}"><div class="muted">没有符合条件的视频。</div></td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `);
}

function renderCell(video, id) {
  if (id === "preview") return previewImage(video);
  if (id === "title") return `<div class="title-link">${escapeHtml(video.title)}</div><div class="subtext">${escapeHtml(video.video_id)} · <a href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">YouTube ↗</a></div>`;
  if (id === "brand") return escapeHtml(video.brand || "—");
  if (id === "product_category") return `<div>${escapeHtml(categoryInline(video.product_category) || "—")}</div><div class="subtext">${escapeHtml(video.industry || "")}</div>`;
  if (id === "genres") return `<div class="tags">${(video.genres || []).map((genre) => `<span class="tag">${escapeHtml(genreShort(genre))}</span>`).join("") || "—"}</div>`;
  if (id === "statuses") return `<div class="tags">${statusPills(video)}</div>`;
  if (id === "publish_date") return formatDateCell(video.publish_date);
  if (id === "duration") return durationCell(video.duration_seconds);
  if (id === "source_type") return escapeHtml(video.source_type || "—");
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
  const genreChecks = state.data.target_genres.map((genre) => `
    <label class="check-row">
      <input type="checkbox" name="genre" value="${escapeHtml(genre)}" ${(video.genres || []).includes(genre) ? "checked" : ""}>
      ${escapeHtml(genreShort(genre))}
    </label>
  `).join("");
  const categoryOptions = state.data.categories.map((item) => `
    <option value="${escapeHtml(item.category)}" ${item.category === video.product_category ? "selected" : ""}>${escapeHtml(item.category)} / ${escapeHtml(item.zh)}</option>
  `).join("");
  const primaryOptions = [`<option value="">无主题材</option>`, ...state.data.target_genres.map((genre) => `
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
        <div class="panel-head compact"><div><h2>基础信息</h2><p>来源、审核结论和原因。</p></div><a class="btn ghost" target="_blank" rel="noreferrer" href="${escapeHtml(video.url)}">打开原链接</a></div>
        <div class="drawer-body">
          <div class="detail-grid">
            ${kv("视频 ID", video.video_id)}
            ${kv("商品品类", categoryInline(video.product_category) || "—")}
            ${kv("来源", video.source_type || "—")}
            ${kv("内容性质", video.content_nature || "—")}
            ${kv("AI 生成价值", video.ai_generation_value || "—")}
            ${kv("发布时间", formatDate(video.publish_date, missingMetadataText))}
            ${kv("时长", duration(video.duration_seconds, missingMetadataText))}
            ${kv("原因码", [...(video.reason_codes || []), ...(video.decision_reason_codes || [])].join(" / ") || "—")}
          </div>
          ${metadataNotice(video)}
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
          <div><h2>${escapeHtml(video.title)}</h2><p class="subtext">${escapeHtml(video.brand)} · ${escapeHtml(categoryInline(video.product_category))} · ${formatDate(video.publish_date, "日期缺失")} · ${duration(video.duration_seconds, "时长缺失")}</p></div>
          <button class="btn ghost" data-close-drawer>关闭</button>
        </div>
        <div class="drawer-body">
          <div class="review-nav">
            <button class="btn ghost" data-prev-video ${canPrev ? "" : "disabled"}>← 上一条</button>
            <div class="review-count">${currentIndex >= 0 ? `${currentIndex + 1} / ${queue.length}` : "不在当前筛选队列"}</div>
            <button class="btn ghost" data-next-video ${canNext ? "" : "disabled"}>下一条 →</button>
          </div>
          <div class="preview-single">
            <iframe class="video-frame" src="${escapeHtml(video.embed_url)}" allowfullscreen title="YouTube preview"></iframe>
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

function renderMethodology() {
  const candidateEvents = state.data.review_events.filter((event) => event.methodology_candidate);
  renderShell(`
    ${pageTop("方法论记录", "第一版只记录人工原因和规则线索，不自动沉淀；后续由 Codex 批量分析。")}
    <div class="content methodology">
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

function bindGlobal() {
  bindImageFallbacks();
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  document.querySelectorAll("[data-matrix-mode]").forEach((button) => button.addEventListener("click", () => {
    state.matrixMode = button.dataset.matrixMode;
    renderMatrix();
  }));
  document.querySelectorAll("[data-goto-category]").forEach((el) => el.addEventListener("click", () => goVideos(el.dataset.gotoCategory, el.dataset.gotoGenre, el.dataset.gotoStatus)));
  document.querySelectorAll("[data-filter]").forEach((input) => input.addEventListener("input", () => {
    state.filters[input.dataset.filter] = input.value;
    renderVideos();
  }));
  document.querySelector("[data-reset-filters]")?.addEventListener("click", () => {
    state.filters = { query: "", category: "all", genre: "all", statusIds: [], statusMode: "include" };
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

boot();
