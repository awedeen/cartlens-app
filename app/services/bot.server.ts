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
  if (!userAgent) {
    return { isBot: true, reason: "No user agent provided" };
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

export function isAllowedByMerchant(
  ipAddress: string | null,
  userAgent: string | null,
  whitelist: string[],
  blacklist: string[]
): boolean | null {
  // Check blacklist first
  if (ipAddress && blacklist.includes(ipAddress)) return false;
  if (userAgent && blacklist.some((pattern) => userAgent.includes(pattern))) return false;

  // Check whitelist
  if (ipAddress && whitelist.includes(ipAddress)) return true;
  if (userAgent && whitelist.some((pattern) => userAgent.includes(pattern))) return true;

  // No explicit allow/block
  return null;
}
