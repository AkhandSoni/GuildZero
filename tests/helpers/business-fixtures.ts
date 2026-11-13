import type { BusinessRequest } from "../../lib/economy/types";
export const businessFixtures: BusinessRequest[] = [
  { serviceType: "csv_validate", inputCsv: "id,units\na,3\na, bad \nb,\nc,5", options: { columns: ["id","units"], numericColumns: ["units"] } },
  { serviceType: "csv_reconcile", inputCsv: "id,amount\na,10\nb,20\nc,30", options: { columns: ["amount"], keyColumn: "id", comparisonCsv: "amount,id\n10,a\n25,b\n40,d" } },
  { serviceType: "csv_report", inputCsv: "region,units\nNorth,3\nSouth,5\nNorth,2\nSouth,", options: { columns: ["units"], groupBy: "region" } },
];
