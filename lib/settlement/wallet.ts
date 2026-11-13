export const GAS_RESERVE = 10n ** 22n;
export function walletAmounts(account: { amount?: unknown; locked?: unknown; storage_usage?: unknown }, storagePrice: unknown) {
  const integer = (value: unknown) => typeof value === "string" && /^(0|[1-9]\d{0,39})$/.test(value);
  if (!integer(account.amount) || !integer(account.locked) || !integer(storagePrice) || !Number.isSafeInteger(account.storage_usage) || Number(account.storage_usage) < 0) throw new Error("INVALID_BALANCE_EVIDENCE");
  const liquid = BigInt(account.amount as string), locked = BigInt(account.locked as string);
  const storage = BigInt(Number(account.storage_usage)) * BigInt(storagePrice as string);
  const available = liquid - storage - GAS_RESERVE;
  return { liquidYocto: liquid.toString(), lockedYocto: locked.toString(), totalYocto: (liquid + locked).toString(), storageYocto: storage.toString(), availableYocto: (available > 0n ? available : 0n).toString() };
}
