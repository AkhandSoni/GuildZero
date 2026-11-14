import { v } from "convex/values";
export const paymentState = v.union(
  v.literal("READY"),
  v.literal("SUBMITTING"),
  v.literal("CONFIRMING"),
  v.literal("UNKNOWN_RECONCILE"),
  v.literal("CONFIRMED"),
  v.literal("FAILED"),
);
export const attemptPhase = v.union(
  v.literal("READY"), v.literal("PREPARING"),
  v.literal("CLOSED_PRE_SIGN_FAILURE"), v.literal("SIGNING_STARTED"),
  v.literal("SIGNED_IDENTITY"), v.literal("BROADCAST_ADMITTED"),
  v.literal("CONFIRMED"), v.literal("FAILED"), v.literal("UNKNOWN_RECONCILE"),
);
