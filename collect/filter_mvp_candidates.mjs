import fs from "node:fs/promises";

const inputPath = new URL("./mvp-candidates-v1.json", import.meta.url);
const outputPath = new URL("./mvp-candidates-filtered-v1.json", import.meta.url);

const source = JSON.parse(await fs.readFile(inputPath, "utf8"));

const channelPatterns = {
  Apple: /^Apple(?:\s|$)/i,
  Samsung: /^Samsung(?:\s|$)/i,
  Sony: /^Sony(?:\s|$)/i,
  Bose: /^Bose(?:\s|$)/i,
  JBL: /^JBL(?:\s|$)/i,
  Sennheiser: /^Sennheiser(?:\s|$)/i,
  Beats: /^Beats by Dre$/i,
  Nothing: /^Nothing$/i,
  Huawei: /^Huawei(?:\s|$)/i,
  Xiaomi: /^Xiaomi(?:\s|$)/i,
  Jabra: /^Jabra(?:\s|$)/i,
  "Bang & Olufsen": /^Bang\s*&\s*Olufsen(?:\s|$)/i,
  Anker: /^Anker(?:\s|$)/i,
  Belkin: /^Belkin(?:\s|$)/i,
  UGREEN: /^UGREEN(?:\s|$)/i,
  Baseus: /^Baseus(?:\s|$)/i,
  CUKTECH: /^CUKTECH(?:\s|$)/i,
  Zendure: /^Zendure(?:\s|$)/i,
  SHARGE: /^SHARGE(?:\s|$)/i,
  EcoFlow: /^EcoFlow(?:\s|$)/i,
};

const productPatterns = {
  "True Wireless / Bluetooth Earbuds":
    /airpods|galaxy buds|earbuds|ear buds|true wireless|quietcomfort.*buds|wf-[a-z0-9]|linkbuds|momentum true wireless|beats fit pro|studio buds|nothing ear|freebuds|xiaomi buds|redmi buds|jabra elite|beoplay (?:ex|eleven|eq|e8)|tour pro|live pro|wave buds|reflect aero/i,
  "Power Banks":
    /power\s*bank|battery\s*pack|portable charger|magsafe battery|magnetic battery|qi2 battery|charging bank/i,
};

const excludedTitlePatterns = {
  "True Wireless / Bluetooth Earbuds":
    /open-ear|open ear|openfit|freeclip|ear clip|bone conduction|over-ear|headband|headphones?\b/i,
  "Power Banks": /portable power station|solar generator|car jump starter/i,
};

const shortlisted = [];
for (const candidate of source.candidates) {
  const matches = [];
  for (const match of candidate.discovery_matches) {
    const channelPattern = channelPatterns[match.expected_brand];
    const productPattern = productPatterns[match.category];
    const excludedPattern = excludedTitlePatterns[match.category];
    if (!channelPattern?.test(candidate.channel || "")) continue;
    if (!productPattern.test(candidate.title || "")) continue;
    if (excludedPattern.test(candidate.title || "")) continue;
    matches.push(match);
  }
  if (!matches.length) continue;

  const uniqueMatches = [
    ...new Map(
      matches.map((match) => [
        `${match.category}\u0000${match.expected_brand}\u0000${match.target_genre}`,
        match,
      ]),
    ).values(),
  ];
  shortlisted.push({ ...candidate, discovery_matches: uniqueMatches });
}

shortlisted.sort((left, right) => {
  const categoryDiff = left.discovery_matches[0].category.localeCompare(
    right.discovery_matches[0].category,
  );
  if (categoryDiff !== 0) return categoryDiff;
  const brandDiff = left.discovery_matches[0].expected_brand.localeCompare(
    right.discovery_matches[0].expected_brand,
  );
  if (brandDiff !== 0) return brandDiff;
  return (right.view_count || 0) - (left.view_count || 0);
});

await fs.writeFile(
  outputPath,
  `${JSON.stringify(
    {
      version: 1,
      generated_at: new Date().toISOString(),
      source_candidate_count: source.candidate_count,
      shortlisted_count: shortlisted.length,
      candidates: shortlisted,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  JSON.stringify({
    source_candidate_count: source.candidate_count,
    shortlisted_count: shortlisted.length,
    output: outputPath.pathname,
  }),
);
