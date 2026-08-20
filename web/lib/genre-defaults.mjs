export function genreDefaultsFromCandidates(candidates = []) {
  const entries = [];
  const indexByGenre = new Map();
  for (const candidate of candidates || []) {
    const value = typeof candidate === "string" ? { genre: candidate, confidence: null } : candidate || {};
    const genre = String(value.genre || "").trim();
    if (!genre) continue;
    const confidence = Number(value.confidence);
    const entry = { genre, confidence: Number.isFinite(confidence) ? confidence : null };
    if (!indexByGenre.has(genre)) {
      indexByGenre.set(genre, entries.length);
      entries.push(entry);
      continue;
    }
    const index = indexByGenre.get(genre);
    if ((entry.confidence ?? -1) > (entries[index].confidence ?? -1)) entries[index] = entry;
  }
  const genres = entries.map((entry) => entry.genre);
  const primary = entries.reduce((best, entry) => {
    if (!best) return entry;
    return (entry.confidence ?? -1) > (best.confidence ?? -1) ? entry : best;
  }, null)?.genre || null;
  return {
    genres,
    primary_genre: primary,
    secondary_genres: genres.filter((genre) => genre !== primary),
  };
}
