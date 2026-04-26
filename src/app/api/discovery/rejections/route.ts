import { listRejections } from '../../../../lib/discovery/read';
import { clearAllRejections } from '../../../../lib/discovery/rejections';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rejections = listRejections();
  return Response.json({ rejections });
}

export async function DELETE() {
  const result = clearAllRejections();
  return Response.json(result);
}
