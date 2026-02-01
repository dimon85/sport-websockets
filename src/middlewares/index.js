const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 50;
const WS_RATE_LIMIT_WINDOW_MS = 2_000;
const WS_RATE_LIMIT_MAX = 5;

const rateLimitStore = new Map();
const wsRateLimitStore = new Map();

const BOT_REGEX = /(bot|crawler|spider|crawling|slurp|preview|curl|wget|httpie)/i;
const ALLOWED_BOT_TOKENS = ["search_engine", "preview"];

const SQLI_REGEX =
  /(\bor\b|\band\b)\s+\d+\s*=\s*\d+|union\s+select|select\s+.*\s+from|insert\s+into|update\s+.*\s+set|delete\s+from|drop\s+table|--|;|\/\*|\*\/|@@|char\(|nchar\(|varchar\(|alter\s+table|cast\(/i;

const XSS_REGEX =
  /<script\b|<\/script>|javascript:|onerror\s*=|onload\s*=|<img\b|<svg\b|<iframe\b|<object\b|<embed\b|<link\b|<style\b|document\.cookie|window\.location/i;

export function isAllowedBot(userAgent = "") {
  if (!userAgent) return false;
  if (!BOT_REGEX.test(userAgent)) return true;
  return ALLOWED_BOT_TOKENS.some((token) =>
    userAgent.toLowerCase().includes(token)
  );
}

function collectStrings(value, out = []) {
  if (value == null) return out;
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, out));
    return out;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, out));
  }
  return out;
}

function hasMaliciousPayload(req) {
  const values = [
    ...collectStrings(req.query),
    ...collectStrings(req.body),
    ...collectStrings(req.params),
  ];

  return values.some((val) => SQLI_REGEX.test(val) || XSS_REGEX.test(val));
}

export function isRateLimited(ip, now) {
  const current = rateLimitStore.get(ip);
  if (!current || now > current.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (current.count >= RATE_LIMIT_MAX) {
    return true;
  }

  current.count += 1;
  return false;
}

function isWebSocketRateLimited(ip, now) {
  const current = wsRateLimitStore.get(ip);
  if (!current || now > current.resetAt) {
    wsRateLimitStore.set(ip, { count: 1, resetAt: now + WS_RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (current.count >= WS_RATE_LIMIT_MAX) {
    return true;
  }

  current.count += 1;
  return false;
}

export const securityMiddleware = (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");

  const userAgent = req.get("user-agent") || "";
  if (!isAllowedBot(userAgent)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const now = Date.now();
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  if (isRateLimited(ip, now)) {
    return res.status(429).json({ error: "Too many requests" });
  }

  if (hasMaliciousPayload(req)) {
    return res.status(400).json({ error: "Service unavailable" });
  }

  return next();
};

export function shouldAllowWebSocket(req) {
  const userAgent = req?.headers?.["user-agent"] || "";
  if (!isAllowedBot(userAgent)) {
    return { allowed: false, reason: "HTTP/1.1 403 Forbidden\r\n\r\n" };
  }

  const now = Date.now();
  const ip = req?.socket?.remoteAddress || req?.connection?.remoteAddress || "unknown";
  if (isWebSocketRateLimited(ip, now)) {
    return { allowed: false, reason: "HTTP/1.1 429 Too many requests\r\n\r\n" };
  }

  return { allowed: true };
}