// Bot detection service

const BOT_USER_AGENTS = [
  "bot",
  "crawler",
  "spider",
  "scraper",
  "curl",
  "wget",
  "python-requests",
  "axios",
  "node-fetch",
  "postman",
  "insomnia",
  "googlebot",
  "bingbot",
  "slurp",
  "duckduckbot",
  "baiduspider",
  "yandexbot",
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "whatsapp",
  "telegram",
  "slack",
  "discord",
];

export interface BotDetectionResult {
  isBot: boolean;
  reason?: string;
}

export function detectBot(userAgent: string | null | undefined): BotDetectionResult {
  // A missing user agent is "unknown", not a bot. Some privacy browsers and
  // accelerated checkout flows omit it, and treating that as a bot would hide
  // real buyers when a shop enables the filter. Only positive UA-pattern matches
  // (below) flag a bot; scrapers are also caught by the webhook burst heuristic.
  if (!userAgent) {
    return { isBot: false };
  }

  const ua = userAgent.toLowerCase();

  // Check against known bot patterns
  for (const botPattern of BOT_USER_AGENTS) {
    if (ua.includes(botPattern)) {
      return { isBot: true, reason: `Matched bot pattern: ${botPattern}` };
    }
  }

  // Check for headless browser indicators
  if (ua.includes("headless")) {
    return { isBot: true, reason: "Headless browser detected" };
  }

  // Check for phantom/selenium
  if (ua.includes("phantom") || ua.includes("selenium")) {
    return { isBot: true, reason: "Automation tool detected" };
  }

  return { isBot: false };
}
