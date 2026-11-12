import { requireActor, route } from "@/lib/http/handler";
import { listActivity } from "@/lib/ratebook/queries";

export const GET = route(async () => ({ activity: await listActivity(await requireActor()) }));
