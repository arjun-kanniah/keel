import { requireActor, route } from "@/lib/http/handler";
import { listProfiles } from "@/lib/ratebook/queries";

export const GET = route(async () => ({ profiles: await listProfiles(await requireActor()) }));
