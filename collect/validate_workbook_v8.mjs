import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "/Users/hakunamatata/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const repoRoot = "/Users/hakunamatata/Desktop/AdGenie";
const workbookPath =
  process.env.WORKBOOK_PATH ||
  "/Users/hakunamatata/Desktop/AdGenie/outputs/019fa13e-2d95-7993-bd68-c5eb1a26d8d6/AdGenie能力需求表-v8.xlsx";
const library = JSON.parse(
  await fs.readFile(
    `${repoRoot}/collect/${process.env.LIBRARY_FILE || "library-v6.json"}`,
    "utf8",
  ),
);
const workbook = await SpreadsheetFile.importXlsx(
  await FileBlob.load(workbookPath),
);
const sampleSheet = workbook.worksheets.getItem("3_样片库");
const matrixSheet = workbook.worksheets.getItem(
  "7_消费电子商品品类",
);
const detailSheet = workbook.worksheets.getItem("8_消费电子模板明细");

const workbookUrls = sampleSheet
  .getRange("H2:H600")
  .values.flat()
  .filter(Boolean);
const libraryUrls = library.videos.map((video) => video.url);
const workbookUrlSet = new Set(workbookUrls);
const libraryUrlSet = new Set(libraryUrls);
const missingFromWorkbook = libraryUrls.filter(
  (url) => !workbookUrlSet.has(url),
);
const extraInWorkbook = workbookUrls.filter(
  (url) => !libraryUrlSet.has(url),
);
const categoryNames = matrixSheet.getRange("C8:D8").values.flat();
const genreNames = matrixSheet
  .getRange("B10:B19")
  .values.flat()
  .map((value) => value.split("\n")[0]);
const matrixValues = matrixSheet.getRange("C10:D19").values;
const matrixTotal = matrixValues
  .flat()
  .reduce((sum, value) => sum + Number(value || 0), 0);
const detailRows = detailSheet.getRange("A6:J400").values.filter((row) => row[0]);
const detailPairCounts = new Map();
for (const row of detailRows) {
  const key = `${row[0]}\u0000${row[3]}`;
  detailPairCounts.set(key, (detailPairCounts.get(key) || 0) + 1);
}
const mismatches = [];
for (let genreIndex = 0; genreIndex < genreNames.length; genreIndex += 1) {
  for (
    let categoryIndex = 0;
    categoryIndex < categoryNames.length;
    categoryIndex += 1
  ) {
    const key = `${categoryNames[categoryIndex]}\u0000${genreNames[genreIndex]}`;
    const expected = detailPairCounts.get(key) || 0;
    const actual = Number(matrixValues[genreIndex][categoryIndex] || 0);
    if (actual !== expected) {
      mismatches.push({
        category: categoryNames[categoryIndex],
        genre: genreNames[genreIndex],
        expected,
        actual,
      });
    }
  }
}
const uniqueDetailUrls = new Set(detailRows.map((row) => row[8]));

console.log(
  JSON.stringify(
    {
      workbookUrls: workbookUrls.length,
      uniqueWorkbookUrls: workbookUrlSet.size,
      libraryUrls: libraryUrls.length,
      uniqueLibraryUrls: libraryUrlSet.size,
      missingFromWorkbook,
      extraInWorkbook,
      categories: categoryNames.length,
      genres: genreNames.length,
      matrixTotal,
      detailRows: detailRows.length,
      uniqueDetailUrls: uniqueDetailUrls.size,
      matrixDetailMismatches: mismatches,
    },
    null,
    2,
  ),
);
