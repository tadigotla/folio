import { hasApiKey, getAgentModel } from '../../../../lib/agent/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    apiKeyPresent: hasApiKey(),
    model: getAgentModel(),
  });
}
