// End-to-end taste-substrate build. Each step is incremental — reruns are
// cheap because every step skips rows that already have the target artifact.

import { spawn } from 'node:child_process';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);

function run(step: string, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${step} ===`);
    const child = spawn('npx', ['tsx', path.join(HERE, file)], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${step} exited with code ${code}`));
    });
  });
}

async function main() {
  await run('transcripts', 'fetch-transcripts.ts');
  await run('enrich', 'enrich.ts');
  await run('embed', 'embed.ts');
  await run('cluster', 'cluster.ts');
  console.log('\n[taste-build] done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
