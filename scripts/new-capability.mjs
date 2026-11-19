#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// Scaffold a capability:
//
//   node scripts/new-capability.mjs records "Listing versions recorded on chain"
//
// Writes two files: a brief, and a declaration whose routes all answer 501.
// The implementation, its tests and its fixtures are the actual work — this
// only puts the folder in the right shape and names the one line to add.

import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = "src/capabilities";

export function identifier(name) {
  return name.replace(/-/g, "");
}

export function isValidName(name) {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name);
}

export function files(name, description) {
  const fn = identifier(name);
  return {
    "README.md": `# ${name}

${description}

## Scope

Replace this with what the module actually has to do, the traps worth knowing
before starting, and the cases that must have tests.

## Done when

\`npm run check\` passes with the tests you add under
\`src/capabilities/${name}/\`, and \`npm run console:probe\` shows every
\`${name}\` route answering 200 instead of 501.

## Rules

- Pure request parsing and planning: nothing but \`../../core\` and
  \`../../ports\`. No npm, no network, no clock of its own.
- Never import another capability. Cross-module traffic goes through a port;
  \`src/capabilities/isolation.test.ts\` enforces it.
- Unknown request fields are rejected, not ignored.
- Changing a port is deliberate: \`npm run freeze\` and a manifest diff.
- Fixtures are obviously fake — \`example.com\`, placeholder words, never a
  value shaped like a real key.
`,

    "capability.ts": `// ${name}: see README.md for the brief. Not written yet — every route below
// answers 501 until it is.

import type { CapabilityModule, CapabilityRoute } from "../types.ts";
import { notBuilt } from "../stub.ts";

const routes: readonly CapabilityRoute[] = [
  { method: "GET", path: "/${name}", handler: () => notBuilt("${name}", "this route") },
];

export const ${fn}Capability: CapabilityModule = {
  name: "${name}",
  summary: "${description.replace(/"/g, "'")}",
  routes: () => routes,
};
`,
  };
}

async function main() {
  const [name, description] = process.argv.slice(2);

  if (!name || !description) {
    process.stderr.write('usage: node scripts/new-capability.mjs <name> "<one-line description>"\n');
    process.exitCode = 2;
    return;
  }
  if (!isValidName(name)) {
    process.stderr.write(`invalid capability name "${name}": use lowercase-kebab-case\n`);
    process.exitCode = 2;
    return;
  }

  const dir = path.join(ROOT, name);
  if ((await readdir(dir).catch(() => null)) !== null) {
    process.stderr.write(`${dir} already exists — nothing written\n`);
    process.exitCode = 1;
    return;
  }

  await mkdir(dir, { recursive: true });
  for (const [file, contents] of Object.entries(files(name, description))) {
    await writeFile(path.join(dir, file), contents, "utf8");
  }

  const fn = identifier(name);
  process.stdout.write(
    `created ${dir}\n\n` +
      `Add two lines to src/capabilities/registry.ts:\n` +
      `  import { ${fn}Capability } from "./${name}/capability.ts";\n` +
      `  ${fn}Capability,\n\n` +
      `Then: npm run check\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
