const SCALE = 10n ** 24n;
export function nearToYocto(value: string): string {
  if (!/^(0|[1-9]\d{0,3})(\.\d{1,24})?$/.test(value))
    throw new Error("Enter a NEAR amount with up to 24 decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * SCALE + BigInt(fraction.padEnd(24, "0"));
  validateBudget(amount.toString());
  return amount.toString();
}
export function validateBudget(value: string): void {
  if (!/^[1-9]\d{0,27}$/.test(value) || BigInt(value) > 1000n * SCALE)
    throw new Error("Budget must be positive and at most 1,000 testnet NEAR.");
}
export function formatNear(value: string): string {
  const amount = BigInt(value);
  const fractional = (amount % SCALE)
    .toString()
    .padStart(24, "0")
    .replace(/0+$/, "");
  return `${amount / SCALE}${fractional ? `.${fractional}` : ""}`;
}
