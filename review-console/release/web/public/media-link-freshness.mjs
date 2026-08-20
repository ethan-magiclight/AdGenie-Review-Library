const bestAdsMediaHost = "bestads-files.b-cdn.net";

export function isStableBestAdsCdnUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === bestAdsMediaHost
      && !url.searchParams.has("token")
      && !url.searchParams.has("expires");
  } catch {
    return false;
  }
}

export function mediaLinkIsFresh(video, nowMs = Date.now()) {
  if (!video.playback_url) return false;
  if (video.media_provider !== "best_ads_signed_mp4") return true;
  if (video.media_access_status === "available" && isStableBestAdsCdnUrl(video.playback_url)) return true;
  const expiresAt = Date.parse(video.media_expires_at || "");
  return Number.isFinite(expiresAt) && expiresAt > nowMs + 5 * 60_000;
}
