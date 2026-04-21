import { runMigrations } from '../src/lib/db';
import { syncSubscriptions } from '../src/lib/subscription-sync';
import { getStoredToken } from '../src/lib/youtube-oauth';

async function main() {
  runMigrations();

  if (!getStoredToken()) {
    console.error('No YouTube OAuth token on file. Connect first at /settings/youtube.');
    process.exit(1);
  }

  const result = await syncSubscriptions();
  console.log(
    `imported=${result.imported} reenabled=${result.reenabled} disabled=${result.disabled}`,
  );
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
