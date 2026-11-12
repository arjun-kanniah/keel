import { requireActor, route } from "@/lib/http/handler";
import { listModules } from "@/lib/ratebook/queries";

export const GET = route(async () => ({ modules: await listModules(await requireActor()) }));
