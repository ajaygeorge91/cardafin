// sessions: see README.md for the brief. Not written yet — every route below
// answers 501 until it is.

import type { CapabilityModule, CapabilityRoute } from "../types.ts";
import { notBuilt } from "../stub.ts";

const routes: readonly CapabilityRoute[] = [
  { method: "POST", path: "/sessions/login", handler: () => notBuilt("sessions", "wallet login") },
  { method: "POST", path: "/sessions/link", handler: () => notBuilt("sessions", "linking an OAuth account to a wallet") },
  { method: "GET", path: "/sessions/current", handler: () => notBuilt("sessions", "reading the current session") },
];

export const sessionsCapability: CapabilityModule = {
  name: "sessions",
  summary: "OAuth and wallet login, and the account link between them.",
  routes: () => routes,
};
