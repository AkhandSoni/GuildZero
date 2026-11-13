import { expect, it, vi } from "vitest";
import { inspectDataset, readCsvFile, readSummary, summaryCsv } from "../../lib/dataset-preview";
function file(name: string, content: string | Uint8Array) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer as ArrayBuffer };
}
it("imports UTF-8 CSV without rewriting BOM, quoted fields or non-ASCII data", async () => {
  const csv = '\ufefflabel,units\r\n"café, bag",3\r\n';
  expect(await readCsvFile(file("SALES.CSV", csv))).toBe(csv);
});
it("rejects file extensions, empty files and oversized files before reading their contents", async () => {
  const read = vi.fn();
  await expect(readCsvFile({ name: "book.xlsx", size: 5, arrayBuffer: read })).rejects.toThrow(".csv");
  await expect(readCsvFile({ name: "empty.csv", size: 0, arrayBuffer: read })).rejects.toThrow("empty");
  await expect(readCsvFile({ name: "large.csv", size: 65537, arrayBuffer: read })).rejects.toThrow("64 KiB");
  expect(read).not.toHaveBeenCalled();
});
it("rejects malformed CSV, binary data, UTF-16 and invalid UTF-8", async () => {
  await expect(readCsvFile(file("bad.csv", "a,b\n1"))).rejects.toThrow("column count");
  await expect(readCsvFile(file("binary.csv", "a\n\0"))).rejects.toThrow("binary or UTF-16");
  await expect(readCsvFile(file("encoded.csv", new Uint8Array([255,254,0,1])))).rejects.toThrow("UTF-8");
});
it("reports actual missing/numeric/invalid counts and source records without guessing transformations", () => {
  const csv = "product,units,price,empty\nBag,3,1e-324,\nBook,,2,\nPen,=SUM(2),4,";
  const result = inspectDataset(csv);
  if (!result.ok) throw new Error(result.message);
  expect(result.value.rowCount).toBe(3);
  expect(result.value.columns[1]).toMatchObject({ missing: 1, numeric: 1, invalid: 1, unsafe: 1, invalidRows: [4] });
  expect(result.value.columns[2]).toMatchObject({ missing: 0, numeric: 2, invalid: 1, invalidRows: [2] });
  expect(result.value.numericColumns).toEqual([]);
  expect(result.value.columns[3]).toMatchObject({ missing: 3, numeric: 0, invalid: 0 });
});
it("suggests only wholly numeric nonempty columns and bounds row previews", () => {
  const result = inspectDataset("name,units\n" + Array(8).fill("Bag,3").join("\n"));
  if (!result.ok) throw new Error(result.message);
  expect(result.value.numericColumns).toEqual(["units"]);
  expect(result.value.previewRows).toHaveLength(5);
  expect(inspectDataset("a,b\n1").ok).toBe(false);
});
it("exports actual stored summary values with explicit missing counts and blank nullable statistics", () => {
  const result = readSummary(JSON.stringify({ serviceType: "csv_summary", format: "json", rowCount: 2, columns: [
    { name: "units", count: 1, missing: 1, min: 3, max: 3, sum: 3, mean: 3 },
    { name: "empty", count: 0, missing: 2, min: null, max: null, sum: 0, mean: null },
  ] }));
  expect(result).not.toBeNull();
  expect(summaryCsv(result!)).toBe("column,count,missing,minimum,maximum,sum,mean\r\nunits,1,1,3,3,3,3\r\nempty,0,2,,,0,");
  expect(summaryCsv({ ...result!, columns: [{ ...result!.columns[0], name: " \t=HYPERLINK(1)" }] })).toBeNull();
});
it.each(["null", "{}", "not-json", '{"serviceType":"csv_summary","format":"json","rowCount":-1,"columns":[]}'])("does not render unsupported or malformed stored summaries: %s", (body) => {
  expect(readSummary(body)).toBeNull();
});
