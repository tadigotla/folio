import path from 'node:path';
import { existsSync } from 'node:fs';

// Load .env.local before importing anything that reads env. Next.js loads
// this automatically at dev/build time; tsx does not, and launchd won't
// inherit the user's shell env either. Resolve relative to the repo root
// (the parent of this scripts/ dir) so the path is stable regardless of
// cwd.
const envPath = path.resolve(new URL('..', import.meta.url).pathname, '.env.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

import { runNightly } from '../src/lib/nightly/run';
import { writeDigest } from '../src/lib/nightly/digest';

async function main() {
  const result = await runNightly();
  writeDigest(result);
  console.log(`[nightly] ${result.status}: ${result.notes}`);
  if (result.lastError) {
    console.error(`[nightly] last_error: ${result.lastError}`);
  }
  process.exit(result.status === 'failed' ? 1 : 0);
}

main().catch((err) => {
  console.error('[nightly] fatal:', err);
  process.exit(1);
});
