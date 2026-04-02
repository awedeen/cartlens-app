// Structured logger for CartLens
// Wraps console with consistent format: [LEVEL] [timestamp] [shop?] message
// Drop-in replacement for console.log/warn/error throughout the app.

type LogLevel = "info" | "warn" | "error";

function log(level: LogLevel, context: string, message: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  const line = `[${level.toUpperCase()}] [${ts}] [${context}] ${message}${metaStr}`;

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (context: string, message: string, meta?: Record<string, unknown>) =>
    log("info", context, message, meta),
  warn: (context: string, message: string, meta?: Record<string, unknown>) =>
    log("warn", context, message, meta),
  error: (context: string, message: string, meta?: Record<string, unknown>) =>
    log("error", context, message, meta),
};
