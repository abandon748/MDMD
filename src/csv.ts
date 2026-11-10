import { parseTable } from "./table-model.ts";
export function tableCsv(source: string) {
  return (
    "\ufeff" +
    parseTable(source)
      .cells.map((row) =>
        row.map((value) => '"' + value.replaceAll('"', '""') + '"').join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
