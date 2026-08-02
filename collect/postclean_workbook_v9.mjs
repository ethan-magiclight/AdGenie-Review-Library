import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const root = "/Users/hakunamatata/Desktop/AdGenie";
const outputDir = path.join(root, "outputs", "019fa13e-2d95-7993-bd68-c5eb1a26d8d6");
const outputPath = path.join(outputDir, "AdGenie能力需求表-v9.xlsx");
const docsPath = path.join(root, "docs", "AdGenie能力需求表-v9.xlsx");
const previewDir = path.join(outputDir, "v9-previews-final");

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath));
const sheet7 = workbook.worksheets.getItem("7_消费电子商品品类");

// A1:E20 is the complete MVP matrix. Remove the obsolete worksheet footprint outside it.
sheet7.getRange("F1:AZ100").clear({ applyTo: "all" });
sheet7.getRange("A21:AZ100").clear({ applyTo: "all" });
sheet7.getRange("F:AZ").format.columnWidth = 0;

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
await fs.copyFile(outputPath, docsPath);

const sheetNames = [
  "0_说明",
  "1_广告类型题材",
  "2_题材×行业矩阵",
  "3_样片库",
  "4_待补采清单",
  "5_收集方法论",
  "6_可替换要素词频",
  "7_消费电子商品品类",
  "8_消费电子模板明细",
];

await fs.mkdir(previewDir, { recursive: true });
for (const sheetName of sheetNames) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(
    path.join(previewDir, `${sheetName}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
}

const matrixInspect = await workbook.inspect({
  kind: "table",
  sheetId: "7_消费电子商品品类",
  range: "A1:E20",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 5,
  maxChars: 30000,
});
const detailInspect = await workbook.inspect({
  kind: "table",
  sheetId: "8_消费电子模板明细",
  range: "A1:J10",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 10,
  maxChars: 12000,
});
const residualInspect = await workbook.inspect({
  kind: "match",
  searchTerm: ".+",
  sheetId: "7_消费电子商品品类",
  range: "F1:AZ100",
  options: { useRegex: true, maxResults: 20 },
  summary: "sheet 7 obsolete footprint scan",
});
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "post-clean formula error scan",
});

await fs.writeFile(
  `${outputPath}.inspect.ndjson`,
  `${matrixInspect.ndjson}\n${detailInspect.ndjson}\n${residualInspect.ndjson}\n${errors.ndjson}\n`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      outputPath,
      docsPath,
      previewDir,
      residualCells: residualInspect.ndjson,
      formulaErrors: errors.ndjson,
    },
    null,
    2,
  ),
);
