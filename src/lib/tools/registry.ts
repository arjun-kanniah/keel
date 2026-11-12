import { z } from "zod";
import { type Actor, type Scope, ROLE_LABEL, hasScope } from "../auth/roles";
import { actorFromRunToken, mintRunToken } from "../auth/actors";
import { AppError } from "../errors";
import type { Changeset, PolicyDecision } from "../ratebook/types";

// The tool contract. One registry serves the in-app assistant and the MCP server, and every
// tool calls the same Ratebook API functions the app's own pages use. A tool declares:
//   - scopes: what the short-lived token it runs with is narrowed to
//   - risk: read | write | bulk | destructive (destructive tools are never exposed)
//   - input: a Zod schema; nothing reaches the API without passing it

export type Risk = "read" | "write" | "bulk" | "destructive";

export interface FormField {
  name: string;
  label: string;
  kind: "text" | "number" | "select";
  options?: string[];
  default?: string | number;
  required?: boolean;
}
export interface FormSpec {
  title: string;
  intro?: string;
  fields: FormField[];
  submitLabel?: string;
}

export interface Citation {
  n: number;
  id: string;
  title: string;
  link: string;
  helpUrl: string;
}

export interface ToolOutput {
  /** What the model sees. */
  text: string;
  /** Structured result for MCP clients and the UI. */
  data?: unknown;
  changeset?: Changeset;
  form?: FormSpec;
  citations?: Citation[];
  isError?: boolean;
  policy?: PolicyDecision[];
}

export interface ToolContext {
  runId: string;
  /** Where to send people to approve (MCP results link here). */
  appUrl: string;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  scopes: Scope[];
  /** Scope checked before the tool runs at all; the API checks the rest per operation. */
  needs?: Scope;
  risk: Risk;
  input: S;
  /** Only for the in-app assistant (e.g. asking the user to fill in a form). */
  inAppOnly?: boolean;
  run: (input: z.infer<S>, actor: Actor, ctx: ToolContext) => Promise<ToolOutput>;
}

export function defineTool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register(...defs: ToolDef[]) {
    for (const d of defs) this.tools.set(d.name, d);
    return this;
  }

  /** Tools a client may see. Destructive tools are left out for everyone. */
  exposed(opts: { inApp: boolean }): ToolDef[] {
    return [...this.tools.values()].filter((t) => t.risk !== "destructive" && (opts.inApp || !t.inAppOnly));
  }

  all(): ToolDef[] {
    return [...this.tools.values()];
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  /**
   * Run a tool for a user. The order is the point: deny list, input validation, a scope check
   * before any planning, then the call itself with the user's identity narrowed to the tool's
   * scopes, never a service account.
   */
  async call(name: string, rawInput: unknown, user: Actor, ctx: ToolContext, opts: { inApp: boolean }): Promise<ToolOutput> {
    const tool = this.tools.get(name);
    if (!tool || !this.exposed(opts).includes(tool)) {
      return { text: `There is no tool called ${name}. Deleting records, exports and billing changes are not available to assistants.`, isError: true };
    }
    const parsed = tool.input.safeParse(rawInput);
    if (!parsed.success) {
      return { text: `Invalid input for ${name}: ${z.prettifyError(parsed.error)}`, isError: true };
    }
    if (tool.needs && !hasScope(user, tool.needs)) {
      const policy: PolicyDecision[] = [
        { rule: "scopes", outcome: "deny", message: `${ROLE_LABEL[user.role]} role lacks ${tool.needs}.` },
      ];
      return {
        text: `Not allowed: the ${ROLE_LABEL[user.role]} role lacks ${tool.needs}, which ${name} needs. Nothing was prepared. Tell the user which role can do it.`,
        isError: true,
        policy,
      };
    }
    const token = mintRunToken(user, ctx.runId, tool.scopes);
    const actor = { ...(await actorFromRunToken(token)), via: user.via === "app" ? "assistant" : user.via } as Actor;
    try {
      return await tool.run(parsed.data, actor, ctx);
    } catch (e) {
      if (e instanceof AppError) {
        const policy = (e.detail?.policy as PolicyDecision[] | undefined) ?? undefined;
        return { text: `${e.status} ${e.code}: ${e.message}`, isError: true, policy };
      }
      throw e;
    }
  }
}

/** JSON Schema for a tool's input, for the Messages API and MCP. */
export function inputSchema(tool: ToolDef): Record<string, unknown> {
  const s = z.toJSONSchema(tool.input, { target: "draft-2020-12" }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}
