export const allowanceDenials: Readonly<Record<string, string>> = {
  DEMO_ALLOWANCE_CONFIGURATION_REQUIRED: "Operator-managed spending permissions are not configured. Ask the operator to configure them.",
  DEMO_OWNER_NOT_ALLOWLISTED: "This account has no operator-approved spending permission. Ask the operator to approve the account.",
  DEMO_OWNER_ALLOWANCE_EXCEEDED: "This account has no sufficient unallocated spending permission for this award.",
  DEMO_OPERATOR_ALLOWANCE_EXCEEDED: "The shared operator spending ceiling cannot admit this award.",
  DEMO_ACCOUNTING_CAPACITY_REACHED: "Spending history exceeds the bounded demo accounting limit. Operator review is required.",
  DEMO_ACCOUNTING_INVALID: "Spending history needs operator review before any new commitment.",
};
