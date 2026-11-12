import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AssistantPanel } from "@/components/AssistantPanel";
import { Nav } from "@/components/Nav";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { config } from "@/lib/config";
import { currentActor } from "@/lib/http/handler";
import { list } from "@/lib/ratebook/changesets";
import { listFolders } from "@/lib/ratebook/queries";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  if (!actor || actor.via !== "app") redirect("/");
  const [folders, waiting] = await Promise.all([listFolders(actor), list(actor, { status: ["awaiting_owner"] })]);
  const model = config.demo ? "claude-haiku-5-5" : config.model;
  return (
    <div className="app">
      <Nav user={{ name: actor.userName, role: ROLE_LABEL[actor.role] }} waiting={waiting.length} />
      <main className="main" id="main">{children}</main>
      <Suspense>
        <AssistantPanel
        user={{ id: actor.userId, name: actor.userName, role: actor.role, roleLabel: ROLE_LABEL[actor.role], scopes: actor.scopes }}
        folders={folders.map((f) => ({ id: f.id, name: f.name }))}
        enabled={config.anthropicConfigured}
        model={model}
        />
      </Suspense>
    </div>
  );
}
