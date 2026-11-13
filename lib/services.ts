export const SERVICE_TYPES = ["csv_normalize", "csv_summary", "csv_validate", "csv_reconcile", "csv_report"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export function isServiceType(value: unknown): value is ServiceType {
  return SERVICE_TYPES.some(service => service === value);
}
export const SERVICE_LABELS: Record<ServiceType, string> = {
  csv_normalize: "Column normalization",
  csv_summary: "Summary statistics",
  csv_validate: "Data quality audit",
  csv_reconcile: "Keyed reconciliation",
  csv_report: "Grouped numeric report",
};
