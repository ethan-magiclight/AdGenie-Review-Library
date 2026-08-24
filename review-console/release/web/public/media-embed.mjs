export function trustedVimeoEmbedUrl(video) {
  if (video?.media_provider !== "vimeo") return null;
  const candidate = video.embed_url || video.playback_url;
  if (!candidate) return null;
  try {
    const url = new URL(candidate, "http://localhost");
    if (url.protocol !== "https:" || url.hostname !== "player.vimeo.com" || !/^\/video\/\d+$/.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}
