import { requireActor, route } from "@/lib/http/handler";
import { listFolders } from "@/lib/ratebook/queries";

export const GET = route(async () => ({ folders: await listFolders(await requireActor()) }));
