/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as audits from "../audits.js";
import type * as bundleEvents from "../bundleEvents.js";
import type * as bundleStars from "../bundleStars.js";
import type * as bundles from "../bundles.js";
import type * as crons from "../crons.js";
import type * as curated from "../curated.js";
import type * as devStats from "../devStats.js";
import type * as github from "../github.js";
import type * as githubCache from "../githubCache.js";
import type * as http from "../http.js";
import type * as leaderboards from "../leaderboards.js";
import type * as lib_embeddings from "../lib/embeddings.js";
import type * as lib_github from "../lib/github.js";
import type * as lib_plans from "../lib/plans.js";
import type * as lib_skillsApi from "../lib/skillsApi.js";
import type * as plans from "../plans.js";
import type * as polar from "../polar.js";
import type * as recommendations from "../recommendations.js";
import type * as skills from "../skills.js";
import type * as subscriptions from "../subscriptions.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  audits: typeof audits;
  bundleEvents: typeof bundleEvents;
  bundleStars: typeof bundleStars;
  bundles: typeof bundles;
  crons: typeof crons;
  curated: typeof curated;
  devStats: typeof devStats;
  github: typeof github;
  githubCache: typeof githubCache;
  http: typeof http;
  leaderboards: typeof leaderboards;
  "lib/embeddings": typeof lib_embeddings;
  "lib/github": typeof lib_github;
  "lib/plans": typeof lib_plans;
  "lib/skillsApi": typeof lib_skillsApi;
  plans: typeof plans;
  polar: typeof polar;
  recommendations: typeof recommendations;
  skills: typeof skills;
  subscriptions: typeof subscriptions;
  users: typeof users;
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
  polar: import("@convex-dev/polar/_generated/component.js").ComponentApi<"polar">;
};
