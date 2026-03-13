import { chromium } from "playwright";

import type { SeedProfile } from "@/lib/agent/contracts";
import { hasAntiBotInterstitialSignal, hasBlockedAccessSignal } from "@/lib/automation/sites/shared";

export type DiscoveryMode = "fixture" | "live" | "hybrid";

export interface LiveDiscoveryArtifact {
  site: string;
  visible_text: string;
  url: string;
  screenshot_ref: string | null;
  extracted_metadata?: {
    title?: string;
    page_category?: string;
    captured_at?: string;
  };
}

const SITE_DOMAINS: Record<string, string> = {
  fastpeoplesearch: "fastpeoplesearch.com",
  spokeo: "spokeo.com",
  radaris: "radaris.com",
  whitepages: "whitepages.com",
  truepeoplesearch: "truepeoplesearch.com",
};

const SEARCH_ENGINE_URL = "https://duckduckgo.com/html/";
const DEFAULT_DISCOVERY_TIMEOUT_MS = 3_000;
const MAX_CAPTURED_TEXT_LENGTH = 12_000;

function normalizeSiteId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function clipText(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > MAX_CAPTURED_TEXT_LENGTH
    ? `${normalized.slice(0, MAX_CAPTURED_TEXT_LENGTH)}...`
    : normalized;
}

function buildSearchQuery(site: string, seedProfile: SeedProfile) {
  return [
    `site:${SITE_DOMAINS[normalizeSiteId(site)] ?? site}`,
    `"${seedProfile.full_name}"`,
    seedProfile.location.city,
    seedProfile.location.state,
    seedProfile.approx_age ?? "",
  ].filter(Boolean).join(" ");
}

function inferPageCategory(url: string, bodyText: string) {
  const normalized = bodyText.toLowerCase();
  if (
    normalized.includes("age")
    || normalized.includes("phone")
    || normalized.includes("address")
    || normalized.includes("relative")
  ) {
    return "listing_detail";
  }
  if (url.includes("duckduckgo.com")) {
    return "search_results";
  }
  return "unknown";
}

async function extractBestResultUrl(page: import("playwright").Page, site: string) {
  const domain = SITE_DOMAINS[normalizeSiteId(site)];
  if (!domain) {
    return null;
  }

  const links = await page.locator("a").evaluateAll((anchors) => anchors.map((anchor) => ({
    href: (anchor as HTMLAnchorElement).href,
    text: anchor.textContent ?? "",
  })));
  const matching = links.find((link) => typeof link.href === "string" && link.href.includes(domain));
  return matching?.href ?? null;
}

async function capturePageArtifact(
  page: import("playwright").Page,
  options: {
    url: string;
    timeoutMs: number;
  },
) {
  await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
  await page.waitForTimeout(1_000);
  const [title, bodyText] = await Promise.all([
    page.title().catch(() => ""),
    page.locator("body").innerText().catch(() => ""),
  ]);

  return {
    title: title || undefined,
    bodyText: clipText(bodyText),
  };
}

export async function captureLiveDiscoveryArtifact(input: {
  site: string;
  seedProfile: SeedProfile;
  timeoutMs?: number;
}): Promise<LiveDiscoveryArtifact | null> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  let browser: import("playwright").Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const searchPage = await browser.newPage();
    const searchUrl = `${SEARCH_ENGINE_URL}?q=${encodeURIComponent(buildSearchQuery(input.site, input.seedProfile))}`;
    const searchCapture = await capturePageArtifact(searchPage, { url: searchUrl, timeoutMs });
    const searchResultUrl = await extractBestResultUrl(searchPage, input.site);

    let finalUrl = searchUrl;
    let finalText = searchCapture.bodyText;
    let finalTitle = searchCapture.title;

    if (searchResultUrl) {
      const listingPage = await browser.newPage();
      try {
        const listingCapture = await capturePageArtifact(listingPage, { url: searchResultUrl, timeoutMs });
        const listingText = listingCapture.bodyText;
        if (listingText && !hasBlockedAccessSignal(listingText) && !hasAntiBotInterstitialSignal(listingText)) {
          finalUrl = searchResultUrl;
          finalText = listingText;
          finalTitle = listingCapture.title;
        }
      } finally {
        await listingPage.close().catch(() => undefined);
      }
    }

    if (!finalText) {
      return null;
    }

    return {
      site: input.site,
      visible_text: finalText,
      url: finalUrl,
      screenshot_ref: null,
      extracted_metadata: {
        title: finalTitle,
        page_category: inferPageCategory(finalUrl, finalText),
        captured_at: new Date().toISOString(),
      },
    };
  } catch {
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
