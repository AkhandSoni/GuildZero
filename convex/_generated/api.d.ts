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
import type * as demo from "../demo.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as marketModel from "../marketModel.js";
import type * as marketViews from "../marketViews.js";
import type * as missions from "../missions.js";
import type * as nearSettlement from "../nearSettlement.js";
import type * as ownership from "../ownership.js";
import type * as paymentHelpers from "../paymentHelpers.js";
import type * as paymentModel from "../paymentModel.js";
import type * as paymentWorker from "../paymentWorker.js";
import type * as payments from "../payments.js";
import type * as publicMarket from "../publicMarket.js";
import type * as security from "../security.js";
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
  demo: typeof demo;
  http: typeof http;
  jobs: typeof jobs;
  marketModel: typeof marketModel;
  marketViews: typeof marketViews;
  missions: typeof missions;
  nearSettlement: typeof nearSettlement;
  ownership: typeof ownership;
  paymentHelpers: typeof paymentHelpers;
  paymentModel: typeof paymentModel;
  paymentWorker: typeof paymentWorker;
  payments: typeof payments;
  publicMarket: typeof publicMarket;
  security: typeof security;
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

export declare const components: {};
