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
import type * as bindAudit from "../bindAudit.js";
import type * as bundleEvents from "../bundleEvents.js";
import type * as bundleStars from "../bundleStars.js";
import type * as bundles from "../bundles.js";
import type * as crons from "../crons.js";
import type * as curated from "../curated.js";
import type * as curatedRefresh from "../curatedRefresh.js";
import type * as devSeed from "../devSeed.js";
import type * as devStats from "../devStats.js";
import type * as duplicates from "../duplicates.js";
import type * as github from "../github.js";
import type * as githubAccount from "../githubAccount.js";
import type * as githubCache from "../githubCache.js";
import type * as githubOnly from "../githubOnly.js";
import type * as githubOnlyAudit from "../githubOnlyAudit.js";
import type * as http from "../http.js";
import type * as leaderboards from "../leaderboards.js";
import type * as lib_appDay from "../lib/appDay.js";
import type * as lib_clerkGithub from "../lib/clerkGithub.js";
import type * as lib_detailRefresh from "../lib/detailRefresh.js";
import type * as lib_discoveryPlacement from "../lib/discoveryPlacement.js";
import type * as lib_embeddings from "../lib/embeddings.js";
import type * as lib_github from "../lib/github.js";
import type * as lib_githubQuota from "../lib/githubQuota.js";
import type * as lib_pagination from "../lib/pagination.js";
import type * as lib_plans from "../lib/plans.js";
import type * as lib_postAdd from "../lib/postAdd.js";
import type * as lib_publicError from "../lib/publicError.js";
import type * as lib_revalidate from "../lib/revalidate.js";
import type * as lib_skillHealth from "../lib/skillHealth.js";
import type * as lib_skillMatch from "../lib/skillMatch.js";
import type * as lib_skillsApi from "../lib/skillsApi.js";
import type * as lib_slugDecision from "../lib/slugDecision.js";
import type * as lib_source from "../lib/source.js";
import type * as lib_typesense from "../lib/typesense.js";
import type * as plans from "../plans.js";
import type * as polar from "../polar.js";
import type * as recommendations from "../recommendations.js";
import type * as reconcile from "../reconcile.js";
import type * as skills from "../skills.js";
import type * as subscriptions from "../subscriptions.js";
import type * as throttle from "../throttle.js";
import type * as typesense from "../typesense.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  audits: typeof audits;
  bindAudit: typeof bindAudit;
  bundleEvents: typeof bundleEvents;
  bundleStars: typeof bundleStars;
  bundles: typeof bundles;
  crons: typeof crons;
  curated: typeof curated;
  curatedRefresh: typeof curatedRefresh;
  devSeed: typeof devSeed;
  devStats: typeof devStats;
  duplicates: typeof duplicates;
  github: typeof github;
  githubAccount: typeof githubAccount;
  githubCache: typeof githubCache;
  githubOnly: typeof githubOnly;
  githubOnlyAudit: typeof githubOnlyAudit;
  http: typeof http;
  leaderboards: typeof leaderboards;
  "lib/appDay": typeof lib_appDay;
  "lib/clerkGithub": typeof lib_clerkGithub;
  "lib/detailRefresh": typeof lib_detailRefresh;
  "lib/discoveryPlacement": typeof lib_discoveryPlacement;
  "lib/embeddings": typeof lib_embeddings;
  "lib/github": typeof lib_github;
  "lib/githubQuota": typeof lib_githubQuota;
  "lib/pagination": typeof lib_pagination;
  "lib/plans": typeof lib_plans;
  "lib/postAdd": typeof lib_postAdd;
  "lib/publicError": typeof lib_publicError;
  "lib/revalidate": typeof lib_revalidate;
  "lib/skillHealth": typeof lib_skillHealth;
  "lib/skillMatch": typeof lib_skillMatch;
  "lib/skillsApi": typeof lib_skillsApi;
  "lib/slugDecision": typeof lib_slugDecision;
  "lib/source": typeof lib_source;
  "lib/typesense": typeof lib_typesense;
  plans: typeof plans;
  polar: typeof polar;
  recommendations: typeof recommendations;
  reconcile: typeof reconcile;
  skills: typeof skills;
  subscriptions: typeof subscriptions;
  throttle: typeof throttle;
  typesense: typeof typesense;
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
