import { listProposedCandidates } from '../../../../lib/discovery/read';

export const dynamic = 'force-dynamic';

export async function GET() {
  const candidates = listProposedCandidates({ limit: 50 });
  return Response.json({ candidates });
}
