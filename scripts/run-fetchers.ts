import { runMigrations } from '../src/lib/db';
import { runOrchestrator } from '../src/fetchers/orchestrator';
import {
  recordSyncError,
  syncSubscriptions,
} from '../src/lib/subscription-sync';
import { getStoredToken } from '../src/lib/youtube-oauth';

async function syncSubscriptionsIfConnected(): Promise<void> {
  if (!getStoredToken()) return;
  try {
    const result = await syncSubscriptions();
    console.log(
      `Subscription sync: imported=${result.imported} reenabled=${result.reenabled} disabled=${result.disabled}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Subscription sync failed: ${message}`);
    try {
      recordSyncError(message);
    } catch {}
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Starting fetcher run...`);
  runMigrations();
  await syncSubscriptionsIfConnected();
  await runOrchestrator();
  console.log(`[${new Date().toISOString()}] Done.`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
