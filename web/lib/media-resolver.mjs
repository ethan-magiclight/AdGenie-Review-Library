const bestAdsMediaHost = "bestads-files.b-cdn.net";
const bestAdsDetailHosts = new Set(["bestadsontv.com", "www.bestadsontv.com"]);

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

async function proxyRequest(proxy, pathname, options = {}) {
  let response;
  try {
    response = await fetch(`${proxy.replace(/\/$/, "")}${pathname}`, {
      ...options,
      signal: AbortSignal.timeout(60_000),
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
    throw new MediaResolutionError("读取 Best Ads 视频地址失败", { code: "MEDIA_PAGE_EVALUATION_FAILED", status: 502 });
  }
  if (typeof result?.value !== "string") return result?.value;
  try {
    return JSON.parse(result.value);
  } catch {
    return result.value;
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
  return {
    playback_url: url.href,
    download_url: url.href,
    checked_at: video.media_checked_at || new Date(nowMs).toISOString(),
    expires_at: video.media_expires_at || null,
    expires_at_ms: video.media_expires_at ? Date.parse(video.media_expires_at) : null,
    access_status: video.media_access_status || "available",
  };
}

export function publicMediaFields(video) {
  const provider = video.media_provider || "";
  if (!new Set(["mp4", "hls", "aotw_cdn", "best_ads_signed_mp4"]).has(provider)) return {};
  const encodedId = encodeURIComponent(video.video_id || video.id);
  return {
    media_resolver_url: `/api/videos/${encodedId}/media`,
    media_download_url: `/api/videos/${encodedId}/media/download`,
  };
}
