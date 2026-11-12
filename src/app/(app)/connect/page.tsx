import { TokenManager } from "@/components/TokenManager";
import { config } from "@/lib/config";
import { pageActor } from "@/lib/http/handler";

export default async function Connect() {
  const actor = await pageActor();
  return (
    <>
      <div><div className="crumb">Settings</div><h2>Connect other AI tools (MCP)</h2></div>
      <p className="empty-hint">
        Ratebook's MCP server offers the same tools as the in-app assistant. A token acts as you ({actor.userName}) with your
        role's permissions. Changes a connected tool prepares wait on the Changes page until someone approves them here.
      </p>
      <p className="mono">{config.appUrl}/api/mcp</p>
      <TokenManager mcpUrl={`${config.appUrl}/api/mcp`} />
    </>
  );
}
