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
