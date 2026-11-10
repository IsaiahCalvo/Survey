// The address an outside agent was given for Survey's MCP connector.
//
// The connector answers at its Supabase function address and, through a
// vercel.json rewrite, at https://surveytool.app/mcp. The rewrite adds
// ?via=site. Agents check that the resource named in the sign-in metadata is
// the address they connected to (RFC 9728; the MCP SDK refuses a mismatch), so
// each request is answered with the address it came through. Both keep
// working: people who added the old address are not cut off.
export const SITE_MCP_URL = 'https://surveytool.app/mcp';

export function mcpPublicUrl(requestUrl, functionUrl) {
  return new URL(requestUrl).searchParams.get('via') === 'site' ? SITE_MCP_URL : functionUrl;
}

export const mcpMetadataUrl = (publicUrl) => `${publicUrl}/.well-known/oauth-protected-resource`;
