import { afterEach, describe, expect, it } from "vitest";
import {
  applyDimensionFilters, DEFAULT_DIMENSION_FILTERS, registerSearchAsCodeProvider,
  type AgentDimensionFilters, type EvalContext,
} from "./agent-chatlist-filter";
import type { Session } from "./types";

const now = Date.parse("2026-11-10T12:00:00Z");
const ctx: EvalContext = {
  machines: [{ id: "mac", name: "Laptop", online: true }, { id: "devbox", name: "Devbox", online: true }],
  pins: { spaces: [], sessions: [] },
  interactions: [],
  now,
};
const session = (id: string, patch: Partial<Session> = {}): Session => ({
  machine_id: "mac", session_id: id, title: "Fix error reporting", cwd: "/test/project",
  agent: "codex", state: "idle", status: "idle",
  updated_at: new Date(now - 36 * 3600_000).toISOString(),
  ...patch,
});
const search = (list: Session[], filters: Partial<AgentDimensionFilters>) =>
  applyDimensionFilters(list, { ...DEFAULT_DIMENSION_FILTERS, ...filters }, ctx);

afterEach(() => registerSearchAsCodeProvider(null));

describe("literal search without Search as Code", () => {
  it.each(["error", "pinned", "working", "today", "codex", "project", "mac", "opus"])(
    "treats %s as title text, not an implicit dimension",
    (query) => {
      const row = session("a", { title: `Fix ${query} reporting`, cwd: "/test/other", agent: "claude", model: "sonnet", machine_id: "devbox" });
      const other = session("b", { title: "Other", repo_root: "/test/project" });
      expect(search([row, other], { query, scope: "title" }).sessions).toEqual([row]);
    },
  );

  it("keeps explicit operators and selected filters active", () => {
    const row = session("a", { turn_error: "error" });
    expect(search([row, session("b")], { query: "is:error machine:mac", harnesses: ["codex"] }).sessions).toEqual([row]);
    expect(search([row], { query: "machine:devbox" }).sessions).toEqual([]);
  });

  it("does not invoke a Search as Code provider when the mode is disabled", () => {
    registerSearchAsCodeProvider({ id: "test", compile: () => { throw new Error("unexpected compile"); } });
    expect(search([session("a")], { query: "error", scope: "title" }).sessions).toHaveLength(1);
  });
});

describe("edited search plans", () => {
  const rows = [session("a"), session("b", { machine_id: "devbox" })];

  it("replaces the generated predicate instead of intersecting with it", () => {
    const result = search(rows, {
      query: "machine:mac", searchAsCode: true,
      customPlanCode: 'session.where(s => s.machine === "devbox")',
    });
    expect(result.sessions).toEqual([rows[1]]);
  });

  it("can remove a condition entirely", () => {
    expect(search(rows, { query: "machine:mac", searchAsCode: true, customPlanCode: "session.where(s => true)" }).sessions).toEqual(rows);
  });

  it("does not execute an inactive custom plan", () => {
    expect(search(rows, { query: "machine:mac", customPlanCode: 'session.where(s => s.machine === "devbox")' }).sessions).toEqual([rows[0]]);
  });

  it("preserves the other generated clauses when changing a machine", () => {
    const recent = session("recent", { machine_id: "devbox", updated_at: new Date(now).toISOString() });
    const original = search([...rows, recent], { query: "machine:mac since:24h error", searchAsCode: true, scope: "title" });
    const edited = original.plan.code.replace('"mac"', '"devbox"').replace("s.hasErrors && ", "");
    // Include a literal text clause so an edit cannot silently drop scope or time filtering.
    const customPlanCode = edited.replace(/\)$/, ' && s.matches("error", "title"))');
    expect(search([...rows, recent, { ...recent, session_id: "unmatched", title: "Other" }], {
      searchAsCode: true, customPlanCode,
    }).sessions).toEqual([recent]);
  });

  it.each([
    '["devbox", "other"].includes(s.machine) && !s.isPinned',
    's.machine === \'devbox\' && s.state === "idle"',
    '/^dev/i.test(s.machine) && s.updatedWithin("48h")',
  ])("evaluates the supported expression %s", (expression) => {
    expect(search(rows, { searchAsCode: true, customPlanCode: `session.where(s => ${expression})` }).sessions).toEqual([rows[1]]);
  });

  it("does not split quoted text or regexes on conjunctions", () => {
    const row = session("quoted", { title: 'Check "a && b" and don\'t' });
    const code = `session.where(s => s.matches(${JSON.stringify('"a && b"')}, "title") && /a && b/.test(s.title) && s.matches('don\\'t', 'title'))`;
    expect(search([row], { searchAsCode: true, customPlanCode: code }).sessions).toEqual([row]);
  });

  it("round-trips generated membership and escaped regex clauses", () => {
    const row = session("model", { model: "custom[1]/v2", repo_root: "/test/team(a)" });
    const filters = { searchAsCode: true, machines: ["mac", "devbox"], projects: ["team(a)", "other"], models: ["custom[1]/v2"] };
    const original = search([row, session("other")], filters);
    const edited = search([row, session("other")], { ...filters, customPlanCode: original.plan.code });
    expect(original.sessions).toEqual([row]);
    expect(edited.plan.invalid).toBe(false);
    expect(edited.sessions).toEqual(original.sessions);
  });

  it.each([
    "", "session.where(s => )", "session.where(s => true && )",
    "session.where(s => false || true)", "session.where(s => unknown())",
    'session.where(s => s.matches("text", "unknown"))',
    'session.where(s => s.updatedWithin("forever"))',
    "session.where(s => /[/.test(s.title))",
    "session.where(s => true); globalThis.__executed = true",
  ])("rejects the entire invalid plan %s", (customPlanCode) => {
    const result = search(rows, { searchAsCode: true, customPlanCode });
    expect(result.plan.invalid).toBe(true);
    expect(result.sessions).toEqual([]);
  });

  it("honors false and exact comparisons rather than silently widening", () => {
    expect(search(rows, { searchAsCode: true, customPlanCode: "session.where(s => false)" }).sessions).toEqual([]);
    expect(search(rows, { searchAsCode: true, customPlanCode: 'session.where(s => s.machine === "dev")' }).sessions).toEqual([]);
  });
});

describe("two-day searches", () => {
  const rows = [23, 24, 36, 48, 49].map((hours) => session(String(hours), { updated_at: new Date(now - hours * 3600_000).toISOString() }));
  it.each(["since:48h", "since:2d", "最近两天", "两天内", "48h"])("honors %s as 48 hours", (query) => {
    expect(search(rows, { query, searchAsCode: true }).sessions.map((s) => s.session_id)).toEqual(["23", "24", "36", "48"]);
  });
  it("keeps the existing one-day boundary", () => {
    expect(search(rows, { query: "since:24h" }).sessions.map((s) => s.session_id)).toEqual(["23", "24"]);
  });
});
