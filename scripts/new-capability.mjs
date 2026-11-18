#!/usr/bin/env node
// Scaffold a capability folder:
//
//   node scripts/new-capability.mjs accounts "Address derivation and discovery"
//
// Writes src/capabilities/<name>/ with the convention from
// docs/PLOTMAP-BRIEF.md §3 and a smoke test that passes immediately, so
// `npm run check` is green from the moment the folder exists. The generated
// body is deliberately thin: what a session is given is the contract, the
// fixtures and the Done-when — not a finished implementation and not a
// finished test suite.

import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = "src/capabilities";

export function toPascal(name) {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

export function isValidName(name) {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name);
}

export function files(name, description) {
  const Pascal = toPascal(name);
  /** The exported identifier for this capability: no hyphens. */
  const fn = name.replace(/-/g, "");
  return {
    "README.md": `# ${name}

${description}

## Done when

Both commands pass from a clean clone, with no \`node_modules\`, no network,
no key and no Blockfrost project id:

\`\`\`
node --test --experimental-strip-types 'src/capabilities/${name}/*.test.ts'
npm run check
\`\`\`

Then, for a look at it working:

\`\`\`
npm run console
\`\`\`

and open the **${Pascal}** panel at http://localhost:8787/console, or
\`npm run console:probe\` for the same checks with no browser.

## Rules this capability keeps

- Pure: \`requests.ts\` and \`plan.ts\` import nothing but \`../../core\` and
  \`../../ports\`. No npm, no lucid, no network.
- Isolated: never imports another capability. Cross-module traffic goes
  through a port. \`src/capabilities/isolation.test.ts\` enforces it.
- Closed shape: unknown request fields are rejected, not ignored.
- Fixtures are obviously fake — \`example.com\`, placeholder words, never a
  value shaped like a real key.
`,

    "requests.ts": `// The client contract for ${name}: parse and validate untrusted input into
// core types. Pure — no ports, no clock, no IO. Unknown fields are rejected
// rather than ignored, the same rule the rest of the service keeps.

import type { Result } from "../../core/result.ts";
import { err, ok } from "../../core/result.ts";
import { CardafinError } from "../../core/errors.ts";

export type ${Pascal}Request = {
  /** Replace with the real contract. Kept so the scaffold typechecks. */
  readonly placeholder?: string;
};

const ALLOWED_FIELDS: readonly string[] = ["placeholder"];

export function parse${Pascal}Request(input: unknown): Result<${Pascal}Request> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return err(new CardafinError("INVALID_REQUEST", "${name}: body must be a JSON object"));
  }

  const unknownFields = Object.keys(input).filter((k) => !ALLOWED_FIELDS.includes(k));
  if (unknownFields.length > 0) {
    return err(
      new CardafinError("INVALID_REQUEST", \`${name}: unknown field(s) \${unknownFields.join(", ")}\`, {
        unknownFields,
      }),
    );
  }

  return ok(input as ${Pascal}Request);
}
`,

    "plan.ts": `// The pure decision layer for ${name}: given a validated request and the
// facts read through a port, work out what should happen. No IO here — that
// is what makes this file exhaustively testable with no network and no key.

import type { ${Pascal}Request } from "./requests.ts";

export type ${Pascal}Plan = {
  readonly capability: "${name}";
  readonly request: ${Pascal}Request;
};

export function plan${Pascal}(request: ${Pascal}Request): ${Pascal}Plan {
  return { capability: "${name}", request };
}
`,

    "service.ts": `// ${Pascal}Service: the ${name} use cases. Depends on core and ports only,
// never on an adapter and never on another capability.

import type { Logger } from "../../ports/logger.ts";
import type { ${Pascal}Plan } from "./plan.ts";
import { plan${Pascal} } from "./plan.ts";
import type { ${Pascal}Request } from "./requests.ts";

export type ${Pascal}ServiceDeps = {
  log: Logger;
};

export class ${Pascal}Service {
  #log: Logger;

  constructor(deps: ${Pascal}ServiceDeps) {
    this.#log = deps.log;
  }

  preview(request: ${Pascal}Request): ${Pascal}Plan {
    const plan = plan${Pascal}(request);
    this.#log.debug("${name}: planned", { capability: plan.capability });
    return plan;
  }
}
`,

    "routes.ts": `// The /v1 routes this capability contributes.
//
// The router never names them. \`src/capabilities/registry.ts\` names this
// module in one line and asks for its routes, which is what lets several
// branches each add a capability without ever editing the same table.
// Every path here must start with \`/${name}\` — \`registry.test.ts\` enforces
// it, and that is what makes one-line registration collision-proof.

import type { CapabilityRoute } from "../types.ts";
import type { ${Pascal}Service } from "./service.ts";

export function ${fn}Routes(service: ${Pascal}Service): readonly CapabilityRoute[] {
  return [
    {
      method: "POST",
      path: "/${name}/preview",
      handler: (input) => ({ status: 200, body: service.preview((input.body ?? {}) as never) }),
    },
  ];
}
`,

    "capability.ts": `// How ${name} plugs into the router: one object, named once in
// \`src/capabilities/registry.ts\`.
//
// All of this capability's wiring lives here, inside its own folder, so the
// shared file stays one line long and parallel branches merge.

import type { CapabilityModule } from "../types.ts";
import { ${fn}Routes } from "./routes.ts";
import { ${Pascal}Service } from "./service.ts";

export const ${fn}Capability: CapabilityModule = {
  name: "${name}",
  summary: "${description.replace(/"/g, "'")}",
  routes: (ctx) => ${fn}Routes(new ${Pascal}Service({ log: ctx.log })),
};
`,

    "memory.ts": `// Deterministic fixtures for ${name}, used by every test and by
// \`npm run console\`. Everything here is obviously fake: example.com,
// placeholder words, never a value shaped like a real key or a real person.

export const ${name.toUpperCase().replace(/-/g, "_")}_FIXTURE_DOMAIN = "cardafin.example.com";
`,

    [`${name}.test.ts`]: `// Smoke test for the ${name} scaffold. It passes as generated, so
// \`npm run check\` is green from the moment the folder exists — and it
// fails honestly the instant the contract below stops holding.

import test from "node:test";
import assert from "node:assert/strict";

import { createLogger } from "../../services/logger.ts";
import { parse${Pascal}Request } from "./requests.ts";
import { ${Pascal}Service } from "./service.ts";

function silentLogger() {
  return createLogger({ secrets: [], sink: () => {} });
}

test("${name}: a well-formed request parses", () => {
  const parsed = parse${Pascal}Request({});
  assert.equal(parsed.ok, true);
});

test("${name}: unknown fields are rejected, not ignored", () => {
  const parsed = parse${Pascal}Request({ surprise: 1 });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error.code, "INVALID_REQUEST");
  }
});

test("${name}: the service previews a plan without touching IO", () => {
  const service = new ${Pascal}Service({ log: silentLogger() });
  assert.equal(service.preview({}).capability, "${name}");
});
`,
  };
}

async function main() {
  const [name, description] = process.argv.slice(2);

  if (!name || !description) {
    process.stderr.write(
      'usage: node scripts/new-capability.mjs <name> "<one-line description>"\n',
    );
    process.exitCode = 2;
    return;
  }
  if (!isValidName(name)) {
    process.stderr.write(`invalid capability name "${name}": use lowercase-kebab-case\n`);
    process.exitCode = 2;
    return;
  }

  const dir = path.join(ROOT, name);
  const existing = await readdir(dir).catch(() => null);
  if (existing !== null) {
    process.stderr.write(`${dir} already exists — nothing written\n`);
    process.exitCode = 1;
    return;
  }

  await mkdir(dir, { recursive: true });
  const written = files(name, description);
  for (const [file, contents] of Object.entries(written)) {
    await writeFile(path.join(dir, file), contents, "utf8");
  }

  const fn = name.replace(/-/g, "");
  process.stdout.write(
    `created ${dir} with ${Object.keys(written).length} files\n\n` +
      `One line left, and it is the only shared file:\n` +
      `  src/capabilities/registry.ts — import { ${fn}Capability } from "./${name}/capability.ts";\n` +
      `                                 and add ${fn}Capability to CAPABILITIES.\n\n` +
      `Then: npm run check\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
