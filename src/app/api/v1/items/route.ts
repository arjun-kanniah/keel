import { requireActor, route } from "@/lib/http/handler";
import { findFolder, listItems } from "@/lib/ratebook/queries";

export const GET = route(async (req) => {
  const actor = await requireActor();
  const u = new URL(req.url);
  const folder = u.searchParams.get("folder");
  const folderId = folder ? (await findFolder(actor, folder)).id : undefined;
  return { items: await listItems(actor, { folderId, type: u.searchParams.get("type") ?? undefined }) };
});
