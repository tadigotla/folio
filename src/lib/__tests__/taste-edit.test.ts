import { beforeEach, describe, expect, it } from 'vitest';
import { setupInMemoryDb } from './setup';
import {
  ConcurrentEditError,
  IllegalEditError,
  mergeClusters,
  reassignVideo,
  retireCluster,
  setClusterFields,
  splitCluster,
} from '../taste-edit';
import { centroidToBlob, normalize } from '../taste';
import { storeEmbedding } from '../embeddings';

const ctx = setupInMemoryDb();

const PROVIDER = 'openai';
const MODEL = 'text-embedding-3-small';

const CHANNEL_ID = 'UC_test_chan';

interface ClusterRow {
  id: number;
  label: string | null;
  weight: number;
  retired_at: string | null;
  updated_at: string;
}

function nowUTC(): string {
  return new Date().toISOString();
}

function seedChannel(): void {
  const ts = nowUTC();
  ctx
    .db()
    .prepare(
      `INSERT INTO channels (id, name, handle, subscribed, first_seen_at, last_checked_at)
       VALUES (?, ?, NULL, 0, ?, ?)`,
    )
    .run(CHANNEL_ID, 'Test Channel', ts, ts);
}

function seedVideo(id: string): void {
  const ts = nowUTC();
  ctx
    .db()
    .prepare(
      `INSERT INTO videos
         (id, title, description, channel_id, duration_seconds, published_at,
          thumbnail_url, source_url, is_live_now, scheduled_start,
          discovered_at, last_checked_at, updated_at, first_seen_at, raw)
       VALUES (?, ?, NULL, ?, 600, ?, NULL, ?, 0, NULL, ?, ?, ?, ?, NULL)`,
    )
    .run(
      id,
      `Video ${id}`,
      CHANNEL_ID,
      ts,
      `https://youtu.be/${id}`,
      ts,
      ts,
      ts,
      ts,
    );
}

function seedEmbedding(videoId: string, vec: number[]): void {
  storeEmbedding(videoId, PROVIDER, MODEL, vec);
}

function insertCluster(centroid: number[], opts: { label?: string | null; weight?: number } = {}): ClusterRow {
  const buf = centroidToBlob(normalize(new Float32Array(centroid)));
  const ts = nowUTC();
  const info = ctx
    .db()
    .prepare(
      `INSERT INTO taste_clusters
         (label, weight, centroid, dim, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(opts.label ?? null, opts.weight ?? 1.0, buf, centroid.length, ts, ts);
  const id = Number(info.lastInsertRowid);
  return loadCluster(id);
}

function loadCluster(id: number): ClusterRow {
  return ctx
    .db()
    .prepare(`SELECT id, label, weight, retired_at, updated_at FROM taste_clusters WHERE id = ?`)
    .get(id) as ClusterRow;
}

function assignVideo(videoId: string, clusterId: number, similarity = 0.9): void {
  ctx
    .db()
    .prepare(
      `INSERT INTO video_cluster_assignments
         (video_id, cluster_id, similarity, is_fuzzy, assigned_at)
       VALUES (?, ?, ?, 0, ?)`,
    )
    .run(videoId, clusterId, similarity, nowUTC());
}

beforeEach(() => {
  process.env.EMBEDDING_PROVIDER = PROVIDER;
  delete process.env.OPENAI_API_KEY; // not needed for read paths
  seedChannel();
});

describe('setClusterFields', () => {
  it('sets label (happy path)', () => {
    const c = insertCluster([1, 0, 0]);
    const newUpdated = setClusterFields(
      c.id,
      { label: 'rigor' },
      { expectedUpdatedAt: c.updated_at },
    );
    const after = loadCluster(c.id);
    expect(after.label).toBe('rigor');
    expect(newUpdated).toBe(after.updated_at);
  });

  it('sets weight (happy path)', () => {
    const c = insertCluster([1, 0, 0]);
    setClusterFields(
      c.id,
      { weight: 1.5 },
      { expectedUpdatedAt: c.updated_at },
    );
    expect(loadCluster(c.id).weight).toBe(1.5);
  });

  it('rejects out-of-range weight (IllegalEditError)', () => {
    const c = insertCluster([1, 0, 0]);
    expect(() =>
      setClusterFields(
        c.id,
        { weight: 99 },
        { expectedUpdatedAt: c.updated_at },
      ),
    ).toThrow(IllegalEditError);
    expect(loadCluster(c.id).weight).toBe(1.0);
  });

  it('throws ConcurrentEditError on stale expectedUpdatedAt', () => {
    const c = insertCluster([1, 0, 0]);
    expect(() =>
      setClusterFields(
        c.id,
        { label: 'foo' },
        { expectedUpdatedAt: '2000-01-01T00:00:00.000Z' },
      ),
    ).toThrow(ConcurrentEditError);
    expect(loadCluster(c.id).label).toBeNull();
  });

  it('throws IllegalEditError when cluster missing', () => {
    expect(() =>
      setClusterFields(
        99999,
        { label: 'x' },
        { expectedUpdatedAt: nowUTC() },
      ),
    ).toThrow(IllegalEditError);
  });
});

describe('reassignVideo', () => {
  it('reassigns to a new cluster (happy path)', () => {
    const a = insertCluster([1, 0, 0]);
    const b = insertCluster([0, 1, 0]);
    seedVideo('vid1');
    seedEmbedding('vid1', [1, 0, 0]);
    assignVideo('vid1', a.id);
    reassignVideo('vid1', b.id);
    const row = ctx
      .db()
      .prepare(`SELECT cluster_id FROM video_cluster_assignments WHERE video_id = ?`)
      .get('vid1') as { cluster_id: number };
    expect(row.cluster_id).toBe(b.id);
  });

  it('rejects reassign to retired cluster (IllegalEditError)', () => {
    const a = insertCluster([1, 0, 0]);
    const b = insertCluster([0, 1, 0]);
    seedVideo('vid1');
    seedEmbedding('vid1', [1, 0, 0]);
    assignVideo('vid1', a.id);
    retireCluster(b.id, { expectedUpdatedAt: b.updated_at });
    expect(() => reassignVideo('vid1', b.id)).toThrow(IllegalEditError);
  });

  it('rejects when video has no current assignment (IllegalEditError)', () => {
    const a = insertCluster([1, 0, 0]);
    seedVideo('vid_unassigned');
    seedEmbedding('vid_unassigned', [1, 0, 0]);
    expect(() => reassignVideo('vid_unassigned', a.id)).toThrow(IllegalEditError);
  });
});

describe('mergeClusters', () => {
  it('merges source into target and retires source', () => {
    const target = insertCluster([1, 0, 0], { label: 'A' });
    const source = insertCluster([0.9, 0.1, 0], { label: 'B' });
    seedVideo('v1');
    seedVideo('v2');
    seedEmbedding('v1', [1, 0, 0]);
    seedEmbedding('v2', [0.9, 0.1, 0]);
    assignVideo('v1', target.id);
    assignVideo('v2', source.id);

    mergeClusters(source.id, target.id, {
      expectedUpdatedAt: target.updated_at,
    });

    const sourceAfter = loadCluster(source.id);
    expect(sourceAfter.retired_at).not.toBeNull();
    const v2Row = ctx
      .db()
      .prepare(`SELECT cluster_id FROM video_cluster_assignments WHERE video_id = ?`)
      .get('v2') as { cluster_id: number };
    expect(v2Row.cluster_id).toBe(target.id);
  });

  it('rejects merging a cluster into itself (IllegalEditError)', () => {
    const c = insertCluster([1, 0, 0]);
    expect(() =>
      mergeClusters(c.id, c.id, { expectedUpdatedAt: c.updated_at }),
    ).toThrow(IllegalEditError);
  });

  it('throws ConcurrentEditError when target moved', () => {
    const target = insertCluster([1, 0, 0]);
    const source = insertCluster([0, 1, 0]);
    seedVideo('v1');
    seedEmbedding('v1', [1, 0, 0]);
    assignVideo('v1', target.id);
    expect(() =>
      mergeClusters(source.id, target.id, {
        expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
      }),
    ).toThrow(ConcurrentEditError);
  });
});

describe('splitCluster', () => {
  it('splits a cluster into k child clusters (happy path)', () => {
    const c = insertCluster([1, 0, 0]);
    seedVideo('a');
    seedVideo('b');
    seedVideo('c');
    seedVideo('d');
    seedEmbedding('a', [1, 0, 0]);
    seedEmbedding('b', [0.9, 0.1, 0]);
    seedEmbedding('c', [0, 1, 0]);
    seedEmbedding('d', [0, 0.9, 0.1]);
    for (const v of ['a', 'b', 'c', 'd']) assignVideo(v, c.id);

    const { childIds } = splitCluster(c.id, 2, {
      expectedUpdatedAt: c.updated_at,
    });
    expect(childIds).toHaveLength(2);
    expect(childIds[0]).toBe(c.id); // first child reuses original id
  });

  it('rejects k < 2 (IllegalEditError)', () => {
    const c = insertCluster([1, 0, 0]);
    expect(() =>
      splitCluster(c.id, 1, { expectedUpdatedAt: c.updated_at }),
    ).toThrow(IllegalEditError);
  });

  it('rejects k > member count (IllegalEditError)', () => {
    const c = insertCluster([1, 0, 0]);
    seedVideo('a');
    seedEmbedding('a', [1, 0, 0]);
    assignVideo('a', c.id);
    expect(() =>
      splitCluster(c.id, 5, { expectedUpdatedAt: c.updated_at }),
    ).toThrow(IllegalEditError);
  });

  it('throws ConcurrentEditError on stale expectedUpdatedAt', () => {
    const c = insertCluster([1, 0, 0]);
    seedVideo('a');
    seedVideo('b');
    seedEmbedding('a', [1, 0, 0]);
    seedEmbedding('b', [0.9, 0.1, 0]);
    assignVideo('a', c.id);
    assignVideo('b', c.id);
    expect(() =>
      splitCluster(c.id, 2, { expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }),
    ).toThrow(ConcurrentEditError);
  });
});

describe('retireCluster', () => {
  it('retires an active cluster (happy path)', () => {
    const c = insertCluster([1, 0, 0]);
    retireCluster(c.id, { expectedUpdatedAt: c.updated_at });
    expect(loadCluster(c.id).retired_at).not.toBeNull();
  });

  it('rejects retiring an already-retired cluster (IllegalEditError)', () => {
    const c = insertCluster([1, 0, 0]);
    retireCluster(c.id, { expectedUpdatedAt: c.updated_at });
    const after = loadCluster(c.id);
    expect(() =>
      retireCluster(c.id, { expectedUpdatedAt: after.updated_at }),
    ).toThrow(IllegalEditError);
  });

  it('throws ConcurrentEditError on stale expectedUpdatedAt', () => {
    const c = insertCluster([1, 0, 0]);
    expect(() =>
      retireCluster(c.id, { expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }),
    ).toThrow(ConcurrentEditError);
  });
});
