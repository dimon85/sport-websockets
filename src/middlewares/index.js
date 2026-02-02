const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 50;
const WS_RATE_LIMIT_WINDOW_MS = 2_000;
const WS_RATE_LIMIT_MAX = 5;
const THREAT_BLOCK_SCORE = 5;

const rateLimitStore = new Map();
const wsRateLimitStore = new Map();
const CLEANUP_INTERVAL_MS = 60_000;

function cleanupStore(store, now) {
  for (const [key, value] of store) {
    if (now > value.resetAt) store.delete(key);
  }
}

setInterval(() => {
  const now = Date.now();
  cleanupStore(rateLimitStore, now);
  cleanupStore(wsRateLimitStore, now);
}, CLEANUP_INTERVAL_MS);

const BOT_REGEX = /(bot|crawler|spider|crawling|slurp|preview|curl|wget|httpie)/i;
const ALLOWED_BOT_TOKENS = ["search_engine", "preview"];

const SQLI_REGEX =
  /\bor\b\s+\d+\s*=\s*\d+|\band\b\s+\d+\s*=\s*\d+|\bunion\b\s+\bselect\b|\binsert\b\s+\binto\b|\bdelete\b\s+\bfrom\b|\bdrop\b\s+\btable\b|--|\/\*|\*\/|@@|\bchar\b\s*\(|\bnchar\b\s*\(|\bvarchar\b\s*\(|\balter\b\s+\btable\b|\bcast\b\s*\(/i;

const XSS_REGEX =
  /<script\b|<\/script>|javascript:|onerror\s*=|onload\s*=|<img\b|<svg\b|<iframe\b|<object\b|<embed\b|<link\b|<style\b|document\.cookie|window\.location/i;

function isBlockedBot(userAgent = "") {
  if (!userAgent) return true;
  if (!BOT_REGEX.test(userAgent)) return false;

  return !ALLOWED_BOT_TOKENS.some((token) =>
    userAgent.toLowerCase().includes(token)
  );
}

function getUserAgent(req) {
  return req?.get?.("user-agent") || req?.headers?.["user-agent"] || "";
}

function getClientIp(req) {
  return req?.ip || req?.socket?.remoteAddress || req?.connection?.remoteAddress || "unknown";
}

function collectStrings(value, out = [], seen = new Set()) {
  if (value == null) return out;
  if (typeof value === "object") {
    if (seen.has(value)) return out;
    seen.add(value);
  }

  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, out, seen));
  } else if (typeof value === "object") {
    Object.values(value).forEach((item) =>
      collectStrings(item, out, seen)
    );
  }

  return out;
}

function getThreatScore(req) {
  const values = [
    ...collectStrings(req.query),
    ...collectStrings(req.body),
    ...collectStrings(req.params),
  ];

  let score = 0;

  for (const val of values) {
    if (val.length > 2000) continue;
    if (SQLI_REGEX.test(val)) score += 2;
    if (XSS_REGEX.test(val)) score += 1;
  }

  return score;
}

function createRateLimiter({ windowMs, max, store }) {
  return function isLimited(key, now = Date.now()) {
    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return false;
    }

    if (++entry.count > max) return true;
    return false;
  };
}

const isRateLimited = createRateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  store: rateLimitStore,
});

const isWebSocketRateLimited = createRateLimiter({
  windowMs: WS_RATE_LIMIT_WINDOW_MS,
  max: WS_RATE_LIMIT_MAX,
  store: wsRateLimitStore,
});

function getHttpRateLimitKey(req) {
  const ip = getClientIp(req);
  return `${ip}:${req.route?.path || req.path}`;
}

function getWsRateLimitKey(req) {
  const ip = getClientIp(req);
  return `${ip}:${req.url}`;
}

export const securityMiddleware = (req, res, next) => {
  const userAgent = getUserAgent(req);
  if (isBlockedBot(userAgent)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const key = getHttpRateLimitKey(req);
  if (isRateLimited(key)) {
    return res.status(429).json({ error: "Too many requests" });
  }

  const threatScore = getThreatScore(req);
  if (threatScore >= THREAT_BLOCK_SCORE) {
    return res.status(400).json({ error: "Service unavailable" });
  }

  next();
};

export const shouldAllowWebSocket = (req) => {
  const userAgent = getUserAgent(req);
  // if (isBlockedBot(userAgent)) {
  //   return { allowed: false, reason: "Forbidden" };
  // }

  const key = getWsRateLimitKey(req);
  if (isWebSocketRateLimited(key)) {
    return { allowed: false, reason: "Rate limit exceeded" };
  }

  return { allowed: true };
};