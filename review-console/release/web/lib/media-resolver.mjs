const bestAdsMediaHost = "bestads-files.b-cdn.net";
const bestAdsDetailHosts = new Set(["bestadsontv.com", "www.bestadsontv.com"]);
const vimeoPlayerHost = "player.vimeo.com";
const stashDirectTimeoutMs = 8_000;
const stashProxyTimeoutMs = 8_000;
const stashProxyHealthTimeoutMs = 3_000;
const defaultProxyTimeoutMs = 60_000;

export class MediaResolutionError extends Error {
  constructor(message, { code = "MEDIA_RESOLUTION_FAILED", status = 502 } = {}) {
    super(message);
    this.name = "MediaResolutionError";
    this.code = code;
    this.status = status;
  }
}

function httpUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new MediaResolutionError(`${label}不是有效 URL`, { code: "INVALID_MEDIA_URL", status: 422 });
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new MediaResolutionError(`${label}协议不受支持`, { code: "INVALID_MEDIA_URL", status: 422 });
  }
  return parsed;
}

function expectedAssetIds(video) {
  return [...new Set([
    video.media_asset_id,
    video.source_post_id,
    ...(video.media_assets || []).flatMap((asset) => [asset.asset_id, asset.source_asset_id]),
  ].filter(Boolean).map(String))];
}

function expectedVimeoId(video) {
  const ids = expectedAssetIds(video).filter((value) => /^\d{6,}$/.test(value));
  if (ids.length !== 1) {
    throw new MediaResolutionError("视频记录缺少唯一 Vimeo ID", {
      code: "MEDIA_ASSET_ID_MISSING",
      status: 422,
    });
  }
  return ids[0];
}

function vimeoPlayerLocator(video) {
  return video.media_provider === "vimeo"
    ? video.playback_url || video.original_media_url
    : video.original_media_url;
}

function validateStashPlayerUrl(value, video) {
  const url = httpUrl(value, "Vimeo 播放页");
  const id = expectedVimeoId(video);
  const actualId = url.pathname.match(/^\/video\/(\d{6,})\/?$/)?.[1] || null;
  if (url.protocol !== "https:" || url.hostname !== vimeoPlayerHost) {
    throw new MediaResolutionError("Vimeo 播放页不在允许范围", {
      code: "UNTRUSTED_SOURCE_URL",
      status: 422,
    });
  }
  if (actualId !== id) {
    throw new MediaResolutionError("Vimeo ID 与审核记录不匹配", {
      code: "MEDIA_ASSET_MISMATCH",
      status: 422,
    });
  }
  const unsupportedQueryKeys = [...url.searchParams.keys()].filter((key) => key !== "h");
  const privateVideoHash = url.searchParams.get("h");
  if (unsupportedQueryKeys.length || (privateVideoHash && !/^[a-z0-9]+$/i.test(privateVideoHash))) {
    throw new MediaResolutionError("Vimeo 播放页包含不受支持的查询参数", {
      code: "UNTRUSTED_SOURCE_URL",
      status: 422,
    });
  }
  url.hash = "";
  return { href: url.href, id };
}

function configRequestFromPlayerHtml(html, videoId, nowMs) {
  const decoded = String(html || "")
    .replaceAll("\\/", "/")
    .replaceAll("\\u0026", "&")
    .replaceAll("&amp;", "&");
  const match = decoded.match(new RegExp(
    `(?:https:\\/\\/${vimeoPlayerHost.replaceAll(".", "\\.")})?\\/video\\/${videoId}\\/config\\/request[^\"'<>\\s\\\\]*`,
    "i",
  ));
  if (!match) {
    throw new MediaResolutionError("Vimeo 播放页没有返回媒体配置定位器", {
      code: "MEDIA_CONFIG_NOT_FOUND",
      status: 502,
    });
  }
  const url = httpUrl(new URL(match[0], `https://${vimeoPlayerHost}`).href, "Vimeo 媒体配置地址");
  if (url.protocol !== "https:" || url.hostname !== vimeoPlayerHost || url.pathname !== `/video/${videoId}/config/request`) {
    throw new MediaResolutionError("Vimeo 媒体配置地址不在允许范围", {
      code: "UNTRUSTED_MEDIA_CONFIG",
      status: 502,
    });
  }
  const expires = Number(url.searchParams.get("expires"));
  const issuedAt = Number(url.searchParams.get("time"));
  if (!url.searchParams.get("signature") || !Number.isFinite(expires) || expires <= 0) {
    throw new MediaResolutionError("Vimeo 媒体配置缺少有效签名", {
      code: "MEDIA_SIGNATURE_MISSING",
      status: 502,
    });
  }
  const absoluteExpires = expires >= 1_000_000_000;
  if (!absoluteExpires && (!Number.isFinite(issuedAt) || issuedAt <= 0)) {
    throw new MediaResolutionError("Vimeo 媒体配置缺少签发时间", {
      code: "MEDIA_SIGNATURE_MISSING",
      status: 502,
    });
  }
  const expiresAtMs = (absoluteExpires ? expires : issuedAt + expires) * 1000;
  if (expiresAtMs <= nowMs + 60_000) {
    throw new MediaResolutionError("Vimeo 媒体配置即将或已经失效", {
      code: "MEDIA_SIGNATURE_EXPIRED",
      status: 502,
    });
  }
  return { href: url.href, expiresAtMs };
}

function validateStashHlsUrl(value) {
  const url = httpUrl(value, "STASH HLS 地址");
  const trustedHost = url.hostname.endsWith(".vimeocdn.com") || url.hostname.endsWith(".akamaized.net");
  if (url.protocol !== "https:" || !trustedHost || !/\.m3u8$/i.test(url.pathname)) {
    throw new MediaResolutionError("STASH HLS 地址不在允许的 CDN", {
      code: "UNTRUSTED_MEDIA_HOST",
      status: 502,
    });
  }
  return url.href;
}

function validateVimeoProgressiveUrl(value) {
  const url = httpUrl(value, "Vimeo MP4 地址");
  const trustedHost = url.hostname.endsWith(".vimeocdn.com") || url.hostname.endsWith(".akamaized.net");
  if (url.protocol !== "https:" || !trustedHost || !/\.mp4$/i.test(url.pathname)) {
    throw new MediaResolutionError("Vimeo MP4 地址不在允许的 CDN", {
      code: "UNTRUSTED_MEDIA_HOST",
      status: 502,
    });
  }
  return url.href;
}

function hlsUrlFromConfig(config) {
  const hls = config?.files?.hls;
  const cdns = hls?.cdns;
  if (!cdns || typeof cdns !== "object") {
    throw new MediaResolutionError("Vimeo 媒体配置没有 HLS 资源", {
      code: "MEDIA_SOURCE_NOT_FOUND",
      status: 502,
    });
  }
  const preferred = hls.default_cdn && cdns[hls.default_cdn];
  const candidates = [preferred, ...Object.values(cdns)]
    .filter(Boolean)
    .flatMap((entry) => [entry.avc_url, entry.url])
    .filter(Boolean);
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return validateStashHlsUrl(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw new MediaResolutionError("Vimeo 媒体配置没有可用的 HLS 资源", {
    code: "MEDIA_SOURCE_NOT_FOUND",
    status: 502,
  });
}

function progressiveUrlFromConfig(config) {
  const candidates = Array.isArray(config?.files?.progressive)
    ? [...config.files.progressive]
      .filter((entry) => entry && typeof entry.url === "string")
      .sort((left, right) => (Number(right.width) || 0) - (Number(left.width) || 0))
    : [];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return validateVimeoProgressiveUrl(candidate.url);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError && candidates.length && !config?.files?.hls?.cdns) throw lastError;
  return null;
}

async function fetchStashMediaResource(fetchImpl, url, accept, timeoutMs = stashDirectTimeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, {
      credentials: "omit",
      headers: { Accept: accept },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new MediaResolutionError("STASH 媒体刷新请求失败", {
      code: "MEDIA_REFRESH_REQUEST_FAILED",
      status: 502,
    });
  }
  if (!response.ok) {
    throw new MediaResolutionError(`STASH 媒体刷新返回 HTTP ${response.status}`, {
      code: "MEDIA_REFRESH_HTTP_ERROR",
      status: 502,
    });
  }
  return response;
}

export async function refreshStashMedia(video, {
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = stashDirectTimeoutMs,
} = {}) {
  const nowMs = now();
  const player = validateStashPlayerUrl(vimeoPlayerLocator(video), video);
  const playerResponse = await fetchStashMediaResource(fetchImpl, player.href, "text/html", timeoutMs);
  const configRequest = configRequestFromPlayerHtml(await playerResponse.text(), player.id, nowMs);
  const configResponse = await fetchStashMediaResource(fetchImpl, configRequest.href, "application/json", timeoutMs);
  let config;
  try {
    config = await configResponse.json();
  } catch {
    throw new MediaResolutionError("Vimeo 媒体配置不是有效 JSON", {
      code: "MEDIA_CONFIG_INVALID",
      status: 502,
    });
  }
  return vimeoMediaDescriptor(config, configRequest.expiresAtMs, nowMs);
}

function vimeoMediaDescriptor(config, expiresAtMs, nowMs) {
  const progressiveUrl = progressiveUrlFromConfig(config);
  const hlsUrl = progressiveUrl ? null : hlsUrlFromConfig(config);
  const playbackUrl = progressiveUrl || hlsUrl;
  return {
    playback_url: playbackUrl,
    download_url: progressiveUrl,
    playback_kind: progressiveUrl ? "progressive_mp4" : "hls",
    download_kind: progressiveUrl ? "progressive_mp4" : null,
    download_available: Boolean(progressiveUrl),
    checked_at: new Date(nowMs).toISOString(),
    expires_at: new Date(expiresAtMs).toISOString(),
    expires_at_ms: expiresAtMs,
    access_status: "temporary",
  };
}

function directDescriptor(playbackUrl, downloadUrl, checkedAt, expiresAt, accessStatus) {
  const isMp4 = /\.mp4(?:$|\?)/i.test(playbackUrl);
  return {
    playback_url: playbackUrl,
    download_url: downloadUrl,
    playback_kind: isMp4 ? "progressive_mp4" : "direct_media",
    download_kind: downloadUrl ? "direct_file" : null,
    download_available: Boolean(downloadUrl),
    checked_at: checkedAt,
    expires_at: expiresAt,
    expires_at_ms: expiresAt ? Date.parse(expiresAt) : null,
    access_status: accessStatus,
  };
}

function validateBestAdsAssetUrl(value, video, label) {
  const url = httpUrl(value, label);
  if (url.protocol !== "https:" || url.hostname !== bestAdsMediaHost) {
    throw new MediaResolutionError("Best Ads 视频地址不在允许的 CDN", { code: "UNTRUSTED_MEDIA_HOST", status: 502 });
  }
  const filename = decodeURIComponent(url.pathname.split("/").pop() || "");
  const assetId = filename.replace(/\.[^.]+$/, "");
  const expected = expectedAssetIds(video);
  if (!expected.length || !expected.includes(assetId)) {
    throw new MediaResolutionError("Best Ads 返回的视频资源与审核记录不匹配", { code: "MEDIA_ASSET_MISMATCH", status: 502 });
  }
  return url;
}

export function validateBestAdsMediaUrl(value, video, nowMs = Date.now()) {
  const url = validateBestAdsAssetUrl(value, video, "Best Ads 视频地址");
  const token = url.searchParams.get("token");
  const expires = Number(url.searchParams.get("expires"));
  if (!token || !Number.isFinite(expires)) {
    throw new MediaResolutionError("Best Ads 返回的视频地址缺少有效签名", { code: "MEDIA_SIGNATURE_MISSING", status: 502 });
  }
  const expiresAtMs = expires * 1000;
  if (expiresAtMs <= nowMs + 60_000) {
    throw new MediaResolutionError("Best Ads 返回的视频地址即将或已经失效", { code: "MEDIA_SIGNATURE_EXPIRED", status: 502 });
  }
  return {
    playback_url: url.href,
    download_url: url.href,
    playback_kind: "progressive_mp4",
    download_kind: "progressive_mp4",
    download_available: true,
    checked_at: new Date(nowMs).toISOString(),
    expires_at: new Date(expiresAtMs).toISOString(),
    expires_at_ms: expiresAtMs,
    access_status: "temporary",
  };
}

export function validateBestAdsDirectMediaUrl(value, video, nowMs = Date.now()) {
  const url = validateBestAdsAssetUrl(value, video, "Best Ads 稳定视频地址");
  return {
    playback_url: url.href,
    download_url: url.href,
    playback_kind: "progressive_mp4",
    download_kind: "direct_file",
    download_available: true,
    checked_at: video.media_checked_at || new Date(nowMs).toISOString(),
    expires_at: null,
    expires_at_ms: null,
    access_status: "available",
  };
}

function validateBestAdsDetailUrl(value) {
  const url = httpUrl(value, "Best Ads 来源详情页");
  if (url.protocol !== "https:" || !bestAdsDetailHosts.has(url.hostname) || !url.pathname.startsWith("/ad/")) {
    throw new MediaResolutionError("Best Ads 来源详情页不在允许范围", { code: "UNTRUSTED_SOURCE_URL", status: 422 });
  }
  return url.href;
}

async function proxyRequest(proxy, pathname, options = {}, fetchImpl = fetch, timeoutMs = defaultProxyTimeoutMs) {
  let response;
  try {
    response = await fetchImpl(`${proxy.replace(/\/$/, "")}${pathname}`, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new MediaResolutionError("媒体刷新服务不可用，请启动 web-access CDP Proxy", {
      code: "MEDIA_REFRESH_PROXY_UNAVAILABLE",
      status: 503,
    });
  }
  if (!response.ok) {
    throw new MediaResolutionError(`媒体刷新服务返回 HTTP ${response.status}`, {
      code: "MEDIA_REFRESH_PROXY_ERROR",
      status: 503,
    });
  }
  return response.json();
}

function evaluatedValue(result) {
  if (result?.error) {
    throw new MediaResolutionError("读取媒体页面失败", { code: "MEDIA_PAGE_EVALUATION_FAILED", status: 502 });
  }
  if (typeof result?.value !== "string") return result?.value;
  try {
    return JSON.parse(result.value);
  } catch {
    return result.value;
  }
}

function browserFetchExpression(url, accept) {
  return `(async()=>{const response=await fetch(${JSON.stringify(url)},{credentials:"omit",headers:{Accept:${JSON.stringify(accept)}},redirect:"error"});const body=await response.text();return JSON.stringify({ok:response.ok,status:response.status,body})})()`;
}

function evaluatedFetchResponse(result) {
  const value = evaluatedValue(result);
  if (!value || typeof value !== "object" || typeof value.body !== "string") {
    throw new MediaResolutionError("浏览器媒体刷新没有返回有效响应", {
      code: "MEDIA_PAGE_EVALUATION_FAILED",
      status: 502,
    });
  }
  if (!value.ok) {
    throw new MediaResolutionError(`浏览器媒体刷新返回 HTTP ${value.status}`, {
      code: "MEDIA_REFRESH_HTTP_ERROR",
      status: 502,
    });
  }
  return value.body;
}

export async function refreshStashMediaViaProxy(video, {
  proxy = process.env.WEB_ACCESS_PROXY || "http://localhost:3456",
  proxyFetchImpl = fetch,
  now = () => Date.now(),
  proxyTimeoutMs = stashProxyTimeoutMs,
  proxyHealthTimeoutMs = stashProxyHealthTimeoutMs,
} = {}) {
  const nowMs = now();
  const player = validateStashPlayerUrl(vimeoPlayerLocator(video), video);
  let targetId = null;
  try {
    await proxyRequest(proxy, "/targets", {}, proxyFetchImpl, proxyHealthTimeoutMs);
    const opened = await proxyRequest(
      proxy,
      `/new?${new URLSearchParams({ url: "about:blank" })}`,
      {},
      proxyFetchImpl,
      proxyTimeoutMs,
    );
    targetId = opened.targetId;
    if (!targetId) {
      throw new MediaResolutionError("媒体刷新服务未创建后台页面", {
        code: "MEDIA_REFRESH_TAB_FAILED",
        status: 503,
      });
    }
    await proxyRequest(
      proxy,
      `/navigate?${new URLSearchParams({ target: targetId, url: player.href })}`,
      {},
      proxyFetchImpl,
      proxyTimeoutMs,
    );
    const playerResult = await proxyRequest(
      proxy,
      `/eval?target=${encodeURIComponent(targetId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: browserFetchExpression(player.href, "text/html"),
      },
      proxyFetchImpl,
      proxyTimeoutMs,
    );
    const configRequest = configRequestFromPlayerHtml(
      evaluatedFetchResponse(playerResult),
      player.id,
      nowMs,
    );
    const configResult = await proxyRequest(
      proxy,
      `/eval?target=${encodeURIComponent(targetId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: browserFetchExpression(configRequest.href, "application/json"),
      },
      proxyFetchImpl,
      proxyTimeoutMs,
    );
    let config;
    try {
      config = JSON.parse(evaluatedFetchResponse(configResult));
    } catch (error) {
      if (error instanceof MediaResolutionError) throw error;
      throw new MediaResolutionError("Vimeo 媒体配置不是有效 JSON", {
        code: "MEDIA_CONFIG_INVALID",
        status: 502,
      });
    }
    return vimeoMediaDescriptor(config, configRequest.expiresAtMs, nowMs);
  } finally {
    if (targetId) {
      await proxyRequest(
        proxy,
        `/close?target=${encodeURIComponent(targetId)}`,
        {},
        proxyFetchImpl,
        proxyHealthTimeoutMs,
      ).catch(() => {});
    }
  }
}

export async function refreshStashMediaWithFallback(video, {
  fetchImpl = fetch,
  proxy = process.env.WEB_ACCESS_PROXY || "http://localhost:3456",
  proxyFetchImpl = fetch,
  now = () => Date.now(),
  preferProxy = false,
  allowProxyFallback = true,
  directTimeoutMs = stashDirectTimeoutMs,
  proxyTimeoutMs = stashProxyTimeoutMs,
  proxyHealthTimeoutMs = stashProxyHealthTimeoutMs,
} = {}) {
  const direct = () => refreshStashMedia(video, { fetchImpl, now, timeoutMs: directTimeoutMs });
  const throughProxy = () => refreshStashMediaViaProxy(video, {
    proxy,
    proxyFetchImpl,
    now,
    proxyTimeoutMs,
    proxyHealthTimeoutMs,
  });
  if (preferProxy) {
    try {
      return await throughProxy();
    } catch (error) {
      if (!(error instanceof MediaResolutionError) || !new Set([
        "MEDIA_REFRESH_PROXY_UNAVAILABLE",
        "MEDIA_REFRESH_PROXY_ERROR",
      ]).has(error.code)) throw error;
      return direct();
    }
  }
  try {
    return await direct();
  } catch (error) {
    if (!allowProxyFallback
      || !(error instanceof MediaResolutionError)
      || error.code !== "MEDIA_REFRESH_REQUEST_FAILED") throw error;
    return throughProxy();
  }
}

export async function refreshBestAdsMedia(video, {
  proxy = process.env.WEB_ACCESS_PROXY || "http://localhost:3456",
  timeoutMs = 20_000,
  now = () => Date.now(),
} = {}) {
  const detailUrl = validateBestAdsDetailUrl(video.source_detail_url);
  let targetId = null;
  try {
    await proxyRequest(proxy, "/targets");
    const opened = await proxyRequest(proxy, `/new?${new URLSearchParams({ url: detailUrl })}`);
    targetId = opened.targetId;
    if (!targetId) {
      throw new MediaResolutionError("媒体刷新服务未创建后台页面", { code: "MEDIA_REFRESH_TAB_FAILED", status: 503 });
    }
    const expression = "JSON.stringify([...new Set([...document.querySelectorAll('video source[src],video[src]')].map(element=>element.currentSrc||element.src||element.getAttribute('src')).filter(Boolean))])";
    const deadline = Date.now() + timeoutMs;
    let latestCandidates = [];
    while (Date.now() < deadline) {
      const result = await proxyRequest(proxy, `/eval?target=${encodeURIComponent(targetId)}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: expression,
      });
      latestCandidates = evaluatedValue(result) || [];
      for (const candidate of latestCandidates) {
        try {
          return validateBestAdsMediaUrl(candidate, video, now());
        } catch (error) {
          if (error.code !== "MEDIA_ASSET_MISMATCH") throw error;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new MediaResolutionError(
      latestCandidates.length ? "Best Ads 页面没有返回与审核记录匹配的视频" : "Best Ads 页面暂未返回可播放视频",
      { code: latestCandidates.length ? "MEDIA_ASSET_MISMATCH" : "MEDIA_SOURCE_NOT_FOUND", status: 502 },
    );
  } finally {
    if (targetId) await proxyRequest(proxy, `/close?target=${encodeURIComponent(targetId)}`).catch(() => {});
  }
}

export function directMediaDescriptor(video, nowMs = Date.now()) {
  const mediaUrl = video.playback_url || video.original_media_url;
  if (!mediaUrl) {
    throw new MediaResolutionError("该视频没有可交付的媒体地址", { code: "MEDIA_URL_MISSING", status: 404 });
  }
  const url = httpUrl(mediaUrl, "视频地址");
  return directDescriptor(
    url.href,
    url.href,
    video.media_checked_at || new Date(nowMs).toISOString(),
    video.media_expires_at || null,
    video.media_access_status || "available",
  );
}

export function publicMediaFields(video) {
  const provider = video.media_provider || "";
  if (!new Set(["mp4", "hls", "vimeo", "aotw_cdn", "best_ads_signed_mp4"]).has(provider)) return {};
  const encodedId = encodeURIComponent(video.video_id || video.id);
  return {
    media_playback_url: `/api/videos/${encodedId}/media`,
    media_resolver_url: `/api/videos/${encodedId}/media`,
    media_download_url: `/api/videos/${encodedId}/media/download`,
    media_download_capability: provider === "hls"
      ? "playback_only_hls"
      : provider === "vimeo"
        ? "runtime_progressive_or_hls"
        : "direct_file",
  };
}
