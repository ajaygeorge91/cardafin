// Structured logging as a port, so services can log without knowing whether
// the sink is stderr, a test array or a log shipper — and so that the one
// implementation that exists (`services/logger.ts`) can be the only place
// redaction has to be right. See docs/ARCHITECTURE.md §6.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}
