/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as audit from "../audit.js";
import type * as capabilities from "../capabilities.js";
import type * as connectors from "../connectors.js";
import type * as contracts from "../contracts.js";
import type * as costControls from "../costControls.js";
import type * as costEvents from "../costEvents.js";
import type * as costOptimization from "../costOptimization.js";
import type * as costVendors from "../costVendors.js";
import type * as credentials from "../credentials.js";
import type * as events from "../events.js";
import type * as externalIntegrations from "../externalIntegrations.js";
import type * as idempotency from "../idempotency.js";
import type * as killSwitches from "../killSwitches.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_cost from "../lib/cost.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_ids from "../lib/ids.js";
import type * as lib_redaction from "../lib/redaction.js";
import type * as lib_validators from "../lib/validators.js";
import type * as nonces from "../nonces.js";
import type * as policies from "../policies.js";
import type * as receipts from "../receipts.js";
import type * as serviceIdentities from "../serviceIdentities.js";
import type * as services from "../services.js";
import type * as systems from "../systems.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  audit: typeof audit;
  capabilities: typeof capabilities;
  connectors: typeof connectors;
  contracts: typeof contracts;
  costControls: typeof costControls;
  costEvents: typeof costEvents;
  costOptimization: typeof costOptimization;
  costVendors: typeof costVendors;
  credentials: typeof credentials;
  events: typeof events;
  externalIntegrations: typeof externalIntegrations;
  idempotency: typeof idempotency;
  killSwitches: typeof killSwitches;
  "lib/audit": typeof lib_audit;
  "lib/authz": typeof lib_authz;
  "lib/cost": typeof lib_cost;
  "lib/errors": typeof lib_errors;
  "lib/ids": typeof lib_ids;
  "lib/redaction": typeof lib_redaction;
  "lib/validators": typeof lib_validators;
  nonces: typeof nonces;
  policies: typeof policies;
  receipts: typeof receipts;
  serviceIdentities: typeof serviceIdentities;
  services: typeof services;
  systems: typeof systems;
  webhooks: typeof webhooks;
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
