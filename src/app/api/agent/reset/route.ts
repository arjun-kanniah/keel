import { requireActor, route } from "@/lib/http/handler";

// Sessions are created on demand; the client just forgets its session id. This exists so the
// client can confirm the user is still signed in before starting over.
export const POST = route(async () => {
  await requireActor();
  return { ok: true };
});
