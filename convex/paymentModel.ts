import { v } from "convex/values";
export const paymentState = v.union(
  v.literal("READY"),
  v.literal("SUBMITTING"),
  v.literal("CONFIRMING"),
  v.literal("UNKNOWN_RECONCILE"),
  v.literal("CONFIRMED"),
  v.literal("FAILED"),
);
