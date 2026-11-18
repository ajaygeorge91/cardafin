// Durable policy storage, replacing the process-lifetime map in
// `http/router.ts` (docs/ARCHITECTURE.md §9).
//
// A policy's native script is its only recovery key: lose the PolicyInfo and
// nothing can ever mint under that policy again, though the tokens stay on
// chain forever. v1 pushed that onto the caller; a port gives it a home so a
// file or SQLite adapter can slot in without touching the service.

import type { PolicyInfo } from "../core/plan.ts";

export interface PolicyStore {
  /** Idempotent on an identical record; rejects a different script under an existing policyId. */
  put(info: PolicyInfo): Promise<void>;
  get(policyId: string): Promise<PolicyInfo | undefined>;
  list(): Promise<PolicyInfo[]>;
}
