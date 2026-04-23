import { ClusterNotFoundError, setMuteToday } from '../../../../../../lib/mutes';
import { parseClusterId } from '../../../_helpers';

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = parseClusterId(raw);
  if (id == null) {
    return Response.json({ error: 'invalid cluster id' }, { status: 400 });
  }
  try {
    const result = setMuteToday(id);
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof ClusterNotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
