import { runMigrations } from '../../src/lib/db';
import { rebuildClusters } from '../../src/lib/taste';

async function main() {
  runMigrations();
  const stats = await rebuildClusters();
  console.log(`[cluster] likes=${stats.likeCount}`);
  console.log(`[cluster] clusters=${stats.clusterCount}`);
  for (const c of stats.perCluster) {
    const tag = c.label ?? '(unlabeled)';
    console.log(`  cluster ${c.id}  n=${c.size}  ${tag}`);
  }
  const fuzzyPct = stats.assignedCount === 0
    ? 0
    : Math.round((stats.fuzzyCount / stats.assignedCount) * 100);
  console.log(
    `[cluster] assigned=${stats.assignedCount} fuzzy=${stats.fuzzyCount} (${fuzzyPct}%)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
