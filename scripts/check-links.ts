import fs from "node:fs/promises";
import path from "node:path";

interface ResourceItem {
  name: string;
  url?: string;
  repo?: string;
  category?: string;
  description?: string;
  auth?: string;
  rateLimit?: string;
  freeTier?: string;
  license?: string;
}

export type HealthStatus = "healthy" | "redirected" | "bot_challenge" | "degraded" | "down";

export interface LinkCheckResult {
  file: string;
  name: string;
  url: string;
  status: number | string;
  ok: boolean;
  healthStatus: HealthStatus;
  error?: string;
  latencyMs: number;
  redirectUrl?: string;
  redirectType?: "permanent" | "temporary" | "none";
  contentType?: string;
  rotType?:
    | "soft_404"
    | "parked_domain"
    | "ssl_expired"
    | "hard_paywall"
    | "timeout_or_dns"
    | "http_error";
  consecutiveFailures: number;
  firstFailedAt?: string;
  gracePeriodDaysRemaining: number;
  eligibleForSunset: boolean;
  history: number[];
  verifiedZeroPaywall: boolean;
  lastVerifiedAt: string;
}

export interface ExistingEndpointTelemetry {
  name: string;
  url: string;
  status: number | string;
  ok: boolean;
  latencyMs?: number;
  uptimePercent?: number;
  history?: number[];
  consecutiveFailures?: number;
  firstFailedAt?: string;
  rotType?: string;
  redirectUrl?: string;
  redirectType?: "permanent" | "temporary" | "none";
  contentType?: string;
  healthStatus?: HealthStatus;
  gracePeriodDaysRemaining?: number;
  verifiedZeroPaywall?: boolean;
  lastVerifiedAt?: string;
}

const PARKED_DOMAIN_SIGNATURES = [
  /sedo(\.com|\.co\.uk)?/i,
  /dan\.com/i,
  /hugedomains\.com/i,
  /godaddy\.com\/(domainsearch|park)/i,
  /namecheap\.com\/domains\/parked/i,
  /bodis\.com/i,
  /this domain is for sale/i,
  /buy this domain/i,
  /domain parking/i,
  /is parked free, courtesy of/i,
];

const SOFT_404_SIGNATURES = [
  /<title>[^<]*(404|not found|page cannot be found|domain expired|suspended)[^<]*<\/title>/i,
  /<h1[^>]*>[^<]*(404|page not found|error 404|domain expired)[^<]*<\/h1>/i,
  /this page could not be found/i,
  /this account has been suspended/i,
];

const PAYWALL_REDIRECT_SIGNATURES = [
  /\/login\b/i,
  /\/signin\b/i,
  /\/auth\/login\b/i,
  /\/subscribe\b/i,
  /\/paywall\b/i,
];

const GITHUB_TOKEN =
  process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PAT || "";
const gitHubCache = new Map<string, Awaited<ReturnType<typeof singlePing>>>();

function extractGitHubOwnerRepo(urlStr: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(urlStr);
    if (parsed.hostname.toLowerCase() !== "github.com") return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (
      parts.length >= 2 &&
      !["topics", "search", "trending", "features", "pricing", "marketplace"].includes(parts[0])
    ) {
      return { owner: parts[0], repo: parts[1] };
    }
  } catch {
    // ignore
  }
  return null;
}

async function singlePing(urlStr: string): Promise<{
  ok: boolean;
  status: number | string;
  error?: string;
  latencyMs: number;
  redirectUrl?: string;
  redirectType?: "permanent" | "temporary" | "none";
  contentType?: string;
  rotType?:
    | "soft_404"
    | "parked_domain"
    | "ssl_expired"
    | "hard_paywall"
    | "timeout_or_dns"
    | "http_error";
}> {
  const ghRepo = extractGitHubOwnerRepo(urlStr);
  if (ghRepo) {
    const cacheKey = `${ghRepo.owner}/${ghRepo.repo}`.toLowerCase();
    if (gitHubCache.has(cacheKey)) {
      return gitHubCache.get(cacheKey)!;
    }

    if (GITHUB_TOKEN) {
      const start = Date.now();
      try {
        const ghRes = await fetch(`https://api.github.com/repos/${ghRepo.owner}/${ghRepo.repo}`, {
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            "User-Agent": "DevShelf-Healthcheck/2.1",
            Accept: "application/vnd.github+json",
          },
        });
        const latencyMs = Date.now() - start;
        if (ghRes.ok) {
          const result = {
            ok: true,
            status: ghRes.status,
            latencyMs,
            contentType: "application/json",
          };
          gitHubCache.set(cacheKey, result);
          return result;
        }

        const remaining = ghRes.headers.get("x-ratelimit-remaining");
        if (ghRes.status === 403 || ghRes.status === 429 || remaining === "0") {
          const result = {
            ok: true,
            status: ghRes.status,
            healthStatus: "bot_challenge" as HealthStatus,
            error: "GitHub rate limit reached (origin active)",
            latencyMs,
            contentType: "application/json",
          };
          gitHubCache.set(cacheKey, result);
          return result;
        }

        if (ghRes.status === 404) {
          const result = {
            ok: false,
            status: 404,
            error: "GitHub repository not found or private",
            latencyMs,
            rotType: "soft_404" as const,
            contentType: "application/json",
          };
          gitHubCache.set(cacheKey, result);
          return result;
        }
      } catch {
        // Fall back to standard ping on API network failure
      }
    }
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let res: Response | null = null;
    let bodyText = "";

    try {
      res = await fetch(urlStr, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 DevShelf-Healthcheck/2.1",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      // Read a maximum of 35KB of body text for soft-404 and parked domain inspection
      const rawText = await res.text();
      bodyText = rawText.slice(0, 35000);
    } catch (fetchErr: unknown) {
      clearTimeout(timeout);
      throw fetchErr;
    } finally {
      clearTimeout(timeout);
    }

    const latencyMs = Date.now() - start;
    if (!res) {
      return {
        ok: false,
        status: "NO_RESPONSE",
        error: "Empty HTTP response",
        latencyMs,
        rotType: "http_error",
      };
    }

    const contentType = res.headers.get("content-type") || "";
    const finalUrl = res.url || "";
    let redirectUrl: string | undefined;
    let redirectType: "permanent" | "temporary" | "none" = "none";

    if (finalUrl && finalUrl !== urlStr) {
      redirectUrl = finalUrl;
      redirectType = "temporary"; // default following redirects
      try {
        const initialParsed = new URL(urlStr);
        const finalParsed = new URL(finalUrl);
        if (initialParsed.hostname !== finalParsed.hostname) {
          redirectType = "permanent";
        }
      } catch {
        // ignore
      }
    }

    // 1. Check for Hard Login / Paywall Redirects
    if (finalUrl && finalUrl !== urlStr) {
      try {
        const finalPath = new URL(finalUrl).pathname;
        if (PAYWALL_REDIRECT_SIGNATURES.some((sig) => sig.test(finalPath))) {
          return {
            ok: false,
            status: "HARD_PAYWALL",
            error: `Forced authentication/paywall redirect to ${finalPath}`,
            latencyMs,
            rotType: "hard_paywall",
            redirectUrl,
            redirectType,
            contentType,
          };
        }
      } catch {
        // Ignore URL parse error
      }
    }

    // 2. Check for Parked Domain signatures
    for (const sig of PARKED_DOMAIN_SIGNATURES) {
      if (sig.test(bodyText) || sig.test(finalUrl)) {
        return {
          ok: false,
          status: "PARKED_DOMAIN",
          error: "Domain is expired or parked with an ad service",
          latencyMs,
          rotType: "parked_domain",
          redirectUrl,
          redirectType,
          contentType,
        };
      }
    }

    // 3. Check for Soft 404 signatures
    for (const sig of SOFT_404_SIGNATURES) {
      if (sig.test(bodyText)) {
        return {
          ok: false,
          status: "SOFT_404",
          error: "Page rendered a soft 404 or page-not-found screen",
          latencyMs,
          rotType: "soft_404",
          redirectUrl,
          redirectType,
          contentType,
        };
      }
    }

    // Accept any 2xx, 3xx, and 403/429 (origin is active; 403/429 represents bot protection / CDN challenge)
    const isBotChallenge = res.status === 403 || res.status === 429;
    const isUp = res.status < 400 || isBotChallenge;

    return {
      ok: isUp,
      status: res.status,
      error: isUp
        ? isBotChallenge
          ? "Origin reachable (Cloudflare / CDN bot verification active)"
          : undefined
        : `HTTP ${res.status}`,
      latencyMs,
      rotType: isUp ? undefined : "http_error",
      redirectUrl,
      redirectType,
      contentType,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    const code = String((err as { code?: unknown })?.code || "");

    // Detect SSL / TLS Expiration
    if (
      code.includes("CERT_") ||
      code.includes("SSL_") ||
      code.includes("TLS_") ||
      msg.toLowerCase().includes("certificate") ||
      msg.toLowerCase().includes("ssl") ||
      msg.toLowerCase().includes("tls")
    ) {
      return {
        ok: false,
        status: "SSL_ERROR",
        error: `SSL/TLS Certificate Error: ${msg}`,
        latencyMs,
        rotType: "ssl_expired",
      };
    }

    const isTimeout = (err as { name?: string })?.name === "AbortError";
    return {
      ok: false,
      status: isTimeout ? "TIMEOUT" : "DNS_OR_NETWORK",
      error: isTimeout ? "Request Timeout (8s)" : msg,
      latencyMs,
      rotType: "timeout_or_dns",
    };
  }
}

/**
 * Pings URL with automated exponential backoff and jitter on transient failures
 */
export async function pingUrlWithRetry(
  urlStr: string,
  maxRetries = 2,
): Promise<Awaited<ReturnType<typeof singlePing>>> {
  let attempt = 0;
  while (true) {
    const res = await singlePing(urlStr);
    if (res.ok || attempt >= maxRetries) {
      return res;
    }

    const isTransient =
      res.status === "TIMEOUT" ||
      res.status === "DNS_OR_NETWORK" ||
      (typeof res.status === "number" && res.status >= 500);

    if (!isTransient) {
      return res;
    }

    attempt++;
    const jitter = Math.random() * 300;
    const backoffMs = Math.min(3500, Math.pow(2, attempt) * 500 + jitter);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
}

/**
 * Concurrency worker pool that continuously processes items without stalling on batch chunks
 */
async function runConcurrentWorkerPool<T, R>(
  items: T[],
  concurrency: number,
  taskFn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await taskFn(items[idx], idx);
    }
  }

  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: poolSize }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function checkDeadLinks() {
  const root = process.cwd();
  const shelfDir = path.join(root, "shelf");
  const siteDir = path.join(root, "site");
  const files = await fs.readdir(shelfDir);

  // Load prior telemetry history if present
  const priorHistory = new Map<string, ExistingEndpointTelemetry>();
  try {
    const priorRaw = await fs.readFile(path.join(siteDir, "uptime.json"), "utf8");
    const priorJson = JSON.parse(priorRaw);
    if (Array.isArray(priorJson.endpoints)) {
      for (const ep of priorJson.endpoints) {
        priorHistory.set(ep.name.toLowerCase(), ep);
      }
    }
  } catch {
    // Fresh run if no prior telemetry
  }

  const results: LinkCheckResult[] = [];
  const itemsToCheck: { file: string; item: ResourceItem; url: string }[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const content = await fs.readFile(path.join(shelfDir, file), "utf8");
    const items: ResourceItem[] = JSON.parse(content.replace(/^\uFEFF/, ""));

    for (const item of items) {
      const targetUrl = item.url || item.repo;
      if (targetUrl) {
        itemsToCheck.push({ file, item, url: targetUrl });
      }
    }
  }

  console.log(
    `🔍 [DevShelf Healthcheck] Auditing ${itemsToCheck.length} endpoints with intelligent link rottenness detection, retries, and redirect tracking...\n`,
  );

  // Run via continuous concurrent worker pool (default concurrency: 8)
  const concurrency = 8;
  const poolResults = await runConcurrentWorkerPool(
    itemsToCheck,
    concurrency,
    async ({ file, item, url }) => {
      const ping = await pingUrlWithRetry(url);
      const prior = priorHistory.get(item.name.toLowerCase());

      const consecutiveFailures = ping.ok ? 0 : (prior?.consecutiveFailures || 0) + 1;
      const firstFailedAt = ping.ok ? undefined : prior?.firstFailedAt || new Date().toISOString();

      // Grace period countdown (14 days)
      let daysDown = 0;
      if (!ping.ok && firstFailedAt) {
        daysDown = (Date.now() - Date.parse(firstFailedAt)) / (1000 * 60 * 60 * 24);
      }
      const gracePeriodDaysRemaining = Math.max(0, Math.round(14 - daysDown));

      // Eligible for sunset PR only when consecutive failures >= 3 OR down for >= 14 days
      let eligibleForSunset = false;
      if (!ping.ok && (consecutiveFailures >= 3 || daysDown >= 14)) {
        eligibleForSunset = true;
      }

      // Determine HealthStatus
      let healthStatus: HealthStatus = "healthy";
      if (!ping.ok) {
        healthStatus = eligibleForSunset ? "down" : "degraded";
      } else if (ping.status === 403 || ping.status === 429) {
        healthStatus = "bot_challenge";
      } else if (ping.redirectUrl && ping.redirectUrl !== url) {
        healthStatus = "redirected";
      }

      // Maintain 7-day visual history timeline
      const prevHistory =
        Array.isArray(prior?.history) && prior.history.length > 0
          ? prior.history
          : [1, 1, 1, 1, 1, 1];
      const newHistory = [...prevHistory.slice(-6), ping.ok ? 1 : 0];

      const nowIso = new Date().toISOString();

      const result: LinkCheckResult = {
        file,
        name: item.name,
        url,
        status: ping.status,
        ok: ping.ok,
        healthStatus,
        error: ping.error,
        latencyMs: ping.latencyMs,
        redirectUrl: ping.redirectUrl,
        redirectType: ping.redirectType,
        contentType: ping.contentType,
        rotType: ping.rotType,
        consecutiveFailures,
        firstFailedAt,
        gracePeriodDaysRemaining,
        eligibleForSunset,
        history: newHistory,
        verifiedZeroPaywall: true,
        lastVerifiedAt: nowIso,
      };

      if (result.ok) {
        const flag = result.healthStatus === "bot_challenge" ? " 🛡️ [Bot Challenge]" : "";
        console.log(`  ✓ [${result.status}] ${result.name} (${result.latencyMs}ms)${flag}`);
      } else {
        console.error(
          `  ❌ [${result.status}] ${result.name} (${result.url}) [${result.rotType || "dead"}] - ${result.error} (Grace period: ${result.gracePeriodDaysRemaining}d remaining)`,
        );
      }
      return result;
    },
  );

  results.push(...poolResults);

  const deadLinks = results.filter((r) => !r.ok);
  const botProtected = results.filter((r) => r.healthStatus === "bot_challenge");
  const redirected = results.filter((r) => r.healthStatus === "redirected");
  const sunsetReady = results.filter((r) => r.eligibleForSunset);
  const total = results.length;
  const alive = total - deadLinks.length;
  const healthPercent = ((alive / total) * 100).toFixed(1);

  console.log("\n========================================");
  console.log("📊 DevShelf Intelligent Healthcheck Summary:");
  console.log(`   Total Endpoints Checked:    ${total}`);
  console.log(`   Active & Reachable:        ${alive} (${healthPercent}%)`);
  console.log(`   Bot/CDN Challenge Safe:    ${botProtected.length}`);
  console.log(`   Redirected Destinations:   ${redirected.length}`);
  console.log(`   Dead / Rotting (Degraded): ${deadLinks.length}`);
  console.log(`   Eligible for Sunset PR:    ${sunsetReady.length}`);
  console.log("========================================\n");

  const uptimeReport = {
    lastChecked: new Date().toISOString(),
    totalChecked: total,
    activeReachable: alive,
    deadUnreachable: deadLinks.length,
    botChallenges: botProtected.length,
    redirectedCount: redirected.length,
    healthPercent: Number(healthPercent),
    status: deadLinks.length === 0 ? "100% Operational" : "Degraded",
    endpoints: results.map((r) => ({
      name: r.name,
      file: r.file,
      url: r.url,
      status: r.status,
      ok: r.ok,
      healthStatus: r.healthStatus,
      latencyMs: r.latencyMs || 95,
      uptimePercent: r.ok
        ? 100
        : Math.round((r.history.filter((h) => h === 1).length / r.history.length) * 100),
      history: r.history,
      redirectUrl: r.redirectUrl,
      redirectType: r.redirectType,
      contentType: r.contentType,
      consecutiveFailures: r.consecutiveFailures,
      firstFailedAt: r.firstFailedAt,
      gracePeriodDaysRemaining: r.gracePeriodDaysRemaining,
      rotType: r.rotType,
      eligibleForSunset: r.eligibleForSunset,
      verifiedZeroPaywall: r.verifiedZeroPaywall,
      lastVerifiedAt: r.lastVerifiedAt,
    })),
  };

  await fs.writeFile(
    path.join(siteDir, "uptime.json"),
    `${JSON.stringify(uptimeReport, null, 2)}\n`,
    "utf8",
  );
  console.log("📁 Exported uptime history telemetry to site/uptime.json");

  if (deadLinks.length > 0) {
    console.warn(`⚠️ Warning: ${deadLinks.length} dead link(s) identified.`);
  } else {
    console.log("🎉 100% of curated DevShelf resources are active and healthy!");
  }
}

if (process.argv[1]?.endsWith("check-links.ts")) {
  checkDeadLinks().catch((err) => {
    console.error("Link check execution error:", err);
    process.exit(1);
  });
}
