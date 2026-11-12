import { appendSpan } from "@/lib/agent/trace";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { AppError, badRequest, notFound } from "@/lib/errors";
import { requireActor, route } from "@/lib/http/handler";
import { apply, cancel, get, requestApproval, undo } from "@/lib/ratebook/changesets";

// apply | undo | cancel | request-approval. When the changeset came from an assistant run, the
// person's decision and the write are added to that run's trace, so the trace tells the story
// end to end.
export const POST = route<{ params: Promise<{ id: string; action: string }> }>(async (req, { params }) => {
  const actor = await requireActor();
  const { id, action } = await params;
  const before = await get(actor, id);
  const who = `${actor.userName} (${ROLE_LABEL[actor.role]})`;
  const runId = before.runId;
  const note = (kind: Parameters<typeof appendSpan>[1], name: string, detail: string) =>
    runId ? appendSpan(runId, kind, name, detail) : Promise.resolve();

  try {
    switch (action) {
      case "apply": {
        const key = req.headers.get("idempotency-key");
        if (!key || key.length > 100) throw badRequest("Send an Idempotency-Key header (any unique string per apply)");
        const cs = await apply(actor, id, key);
        await note("human", "approved", `${who} approved ${id}`);
        await note("write", "apply_changeset", `${cs.ops.length} ops in one transaction, versions checked`);
        return { changeset: cs };
      }
      case "undo": {
        const cs = await undo(actor, id);
        await note("write", "undo_changeset", `${who} undid ${id}; ${cs.ops.length} values restored`);
        return { changeset: cs };
      }
      case "cancel": {
        const cs = await cancel(actor, id);
        await note("human", "cancelled", `${who} cancelled ${id}; nothing written`);
        return { changeset: cs };
      }
      case "request-approval": {
        const cs = await requestApproval(actor, id);
        await note("human", "approval_requested", `${who} sent ${id} to an Owner`);
        return { changeset: cs };
      }
      default:
        throw notFound(`Action ${action}`);
    }
  } catch (e) {
    if (e instanceof AppError && action === "apply") {
      await note(e.status === 409 ? "write" : "policy", "apply_rejected", `${who}: ${e.status} ${e.message}`);
    }
    throw e;
  }
});
