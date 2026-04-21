import { disconnect } from '../../../../../lib/youtube-oauth';

export async function POST() {
  disconnect();
  return new Response(null, { status: 204 });
}
