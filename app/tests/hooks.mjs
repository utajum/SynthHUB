// Node module hooks so app sources run under `node --test` unchanged:
// Vite-style extensionless imports resolve to .ts, and JSON imports work
// without an `with { type: 'json' }` attribute.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if (
    (specifier.startsWith('.') || specifier.startsWith('/')) &&
    !/\.(m?js|ts|tsx|json)$/.test(specifier) &&
    context.parentURL
  ) {
    for (const ext of ['.ts', '/index.ts']) {
      const url = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(url))) return next(url.href, context);
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('file:') && url.endsWith('.json')) {
    const source = await readFile(new URL(url), 'utf8');
    return { format: 'json', source, shortCircuit: true };
  }
  return next(url, context);
}
