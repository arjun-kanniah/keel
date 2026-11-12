import { requireActor, route } from "@/lib/http/handler";
import { get } from "@/lib/ratebook/changesets";

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => ({
  changeset: await get(await requireActor(), (await params).id),
}));
