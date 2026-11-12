import { t } from "../i18n";
import { sessionPreview } from "./format";
import type { Session } from "./types";
import { parseSearchQuery, scopeHaystacks, sessionHasError, type EvalContext, type EvidenceSnippet, type SearchScope } from "./agent-chatlist-filter";

/** Build a role-attributed evidence snippet with highlighted match span when a search query is active. */
export function buildEvidenceSnippet(s: Session, query: string, scope: SearchScope, ctx: EvalContext): EvidenceSnippet | null {
  const parsed = parseSearchQuery(query);
  const terms = parsed.terms.length > 0 ? parsed.terms : [];
  if (terms.length === 0 && scope !== "errors") return null;

  const candidates = scopeHaystacks(s, scope, ctx).filter((c) => c.text.trim().length > 0);
  const roleLabelOf = (role: EvidenceSnippet["role"]): string => {
    switch (role) {
      case "user":
        return t("lib-agent-filter.role_user");
      case "error":
        return t("lib-agent-filter.role_error");
      case "title":
        return t("lib-agent-filter.role_title");
      case "agent":
      default:
        return t("lib-agent-filter.role_agent");
    }
  };

  for (const c of candidates) {
    const text = c.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    for (const term of terms) {
      const idx = text.toLowerCase().indexOf(term.toLowerCase());
      if (idx >= 0) {
        const start = Math.max(0, idx - 28);
        const end = Math.min(text.length, idx + term.length + 52);
        const before = (start > 0 ? "…" : "") + text.slice(start, idx);
        const match = text.slice(idx, idx + term.length);
        const after = text.slice(idx + term.length, end) + (end < text.length ? "…" : "");
        return { role: c.role, roleLabel: roleLabelOf(c.role), before, match, after };
      }
    }
  }

  if (scope === "errors" && sessionHasError(s, ctx.interactions)) {
    const errCandidate = candidates[0]?.text.replace(/\s+/g, " ").trim().slice(0, 90) || sessionPreview(s);
    if (errCandidate) {
      return { role: "error", roleLabel: roleLabelOf("error"), before: "", match: errCandidate, after: "" };
    }
  }
  return null;
}
