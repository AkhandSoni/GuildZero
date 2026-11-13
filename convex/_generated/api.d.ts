/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentPolicies from "../agentPolicies.js";
import type * as auth from "../auth.js";
import type * as deliveryAccess from "../deliveryAccess.js";
import type * as demo from "../demo.js";
import type * as economyWorker from "../economyWorker.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as legacyAuthSchema from "../legacyAuthSchema.js";
import type * as maintenance from "../maintenance.js";
import type * as marketModel from "../marketModel.js";
import type * as marketViews from "../marketViews.js";
import type * as missions from "../missions.js";
import type * as nearSettlement from "../nearSettlement.js";
import type * as operatorWallet from "../operatorWallet.js";
import type * as operatorWalletActions from "../operatorWalletActions.js";
import type * as ownership from "../ownership.js";
import type * as paymentHelpers from "../paymentHelpers.js";
import type * as paymentModel from "../paymentModel.js";
import type * as paymentWorker from "../paymentWorker.js";
import type * as payments from "../payments.js";
import type * as publicMarket from "../publicMarket.js";
import type * as security from "../security.js";
import type * as settlementReadiness from "../settlementReadiness.js";
import type * as workflow from "../workflow.js";
import type * as workflowHelpers from "../workflowHelpers.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentPolicies: typeof agentPolicies;
  auth: typeof auth;
  deliveryAccess: typeof deliveryAccess;
  demo: typeof demo;
  economyWorker: typeof economyWorker;
  http: typeof http;
  jobs: typeof jobs;
  legacyAuthSchema: typeof legacyAuthSchema;
  maintenance: typeof maintenance;
  marketModel: typeof marketModel;
  marketViews: typeof marketViews;
  missions: typeof missions;
  nearSettlement: typeof nearSettlement;
  operatorWallet: typeof operatorWallet;
  operatorWalletActions: typeof operatorWalletActions;
  ownership: typeof ownership;
  paymentHelpers: typeof paymentHelpers;
  paymentModel: typeof paymentModel;
  paymentWorker: typeof paymentWorker;
  payments: typeof payments;
  publicMarket: typeof publicMarket;
  security: typeof security;
  settlementReadiness: typeof settlementReadiness;
  workflow: typeof workflow;
  workflowHelpers: typeof workflowHelpers;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  auth: import("@convex-dev/auth/_generated/component.js").ComponentApi<"auth">;
  authPassword: import("@convex-dev/auth/components/password/_generated/component.js").ComponentApi<"authPassword">;
  legacyAuthLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"legacyAuthLimiter">;
};
