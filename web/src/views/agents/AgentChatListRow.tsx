import { memo, useMemo } from "react";
import { t } from "../../i18n";
import { flipPin } from "../../lib/agent-actions";
import { buildEvidenceSnippet } from "../../lib/agent-chatlist-evidence";
import { sessionHarnessLabel, sessionHasError, sessionModelId, sessionProjectName, type AgentDimensionFilters, type EvalContext } from "../../lib/agent-chatlist-filter";
import { awaitsReply, sessionSource, sourceName, type AgentMutes } from "../../lib/agent-groups";
import { ago, backgroundWaiting, sessionPreview, sessionTitle, stateOf } from "../../lib/format";
import { sessionCard } from "../../lib/folded-rows";
import { machineWithHub } from "../../lib/mesh";
import { plainMarkdown } from "../../lib/plain-markdown";
import { href, type Route } from "../../lib/router";
import { draftLine, rowLine } from "../../lib/row-line";
import { useLeftDraft } from "../../lib/drafts";
import { rememberSessionRow, useStore } from "../../lib/store";
import type { Session } from "../../lib/types";
import { ultracodeMarkShown } from "../../lib/ultracode";
import { SessionMark } from "../../ui/AgentMark";
import { cx, useNow } from "../../ui/atoms";
import { contextMenuProps } from "../../ui/context-menu";
import { Icon } from "../../ui/icons";
import { StatusMark } from "../../ui/StatusMark";
import { UltraMark } from "../chat/Ultracode";
import { CURRENT_ROW, type GoFn, type RegFn, type RowMenuFn } from "../SidebarParts";

/** IM Chat-List style Agent Session Row:
 *  - Left: Harness avatar tile + live status dot badge on the bottom-right corner
 *  - Top line: Bold session title (+ Ultracode / Pinned indicator) + relative timestamp on the right
 *  - Second line: Role-attributed search evidence snippet (with highlighted match) OR live last message / tool summary
 *  - Bottom compact chips: `Machine · Project · Harness · Model`
 *  - Right action: One-click Pin / Unpin button + `⋯` actions menu
 */
export const AgentChatListRow = memo(function AgentChatListRow({
  s,
  k,
  reg,
  hover,
  active,
  to,
  go,
  pinned,
  mutes,
  filters,
  ctx,
  onMenu,
}: {
  s: Session;
  k: string;
  reg: RegFn;
  hover: (k: string | null) => void;
  active: boolean;
  to: Route;
  go: GoFn;
  pinned: boolean;
  mutes: AgentMutes;
  filters: AgentDimensionFilters;
  ctx: EvalContext;
  onMenu?: RowMenuFn;
}) {
  const st = stateOf(s);
  const awaiting = awaitsReply(s, mutes);
  const ix = useStore((state) => sessionCard(state.interactions, s.machine_id, s.session_id));
  const draft = draftLine(useLeftDraft(`${s.machine_id}/${s.session_id}`));
  const line: { lead?: string; text: string; tone?: "needs" | "reply" } | undefined = draft ?? rowLine(s, ix, awaiting);
  const previewText = line?.text || plainMarkdown(sessionPreview(s)) || s.activity || "";
  const now = useNow(60_000, Boolean(s.updated_at));
  const timeLabel = s.updated_at ? ago(s.updated_at, now) : "";
  const ultra = ultracodeMarkShown(s);
  const hasErr = sessionHasError(s, ctx.interactions);

  const evidence = useMemo(
    () => (filters.query.trim() || filters.scope === "errors" ? buildEvidenceSnippet(s, filters.query, filters.scope, ctx) : null),
    [s, filters.query, filters.scope, ctx],
  );

  const machineLabel = machineWithHub(s.machine_id, ctx.machines) || s.machine_id;
  const projectLabel = sessionProjectName(s);
  const harnessLabel = sessionHarnessLabel(s);
  const modelLabel = sessionModelId(s);
  const source = sessionSource(s);
  const regRow = useMemo(() => reg(k), [reg, k]);

  return (
    <div
      data-testid="agent-chatlist-row"
      data-session-id={s.session_id}
      data-pinned={pinned ? "true" : "false"}
      className={cx(
        "group/row relative rounded-[10px] transition-colors",
        pinned && !active && "bg-inset/45 ring-1 ring-line/60",
      )}
    >
      <a
        ref={regRow}
        href={href(to)}
        onClick={(e) => {
          rememberSessionRow(s);
          go(to)(e);
        }}
        {...(onMenu ? contextMenuProps((at, el) => onMenu(s, el, at)) : {})}
        onMouseEnter={() => hover(k)}
        onFocus={() => hover(k)}
        onBlur={() => hover(null)}
        aria-current={active ? "page" : undefined}
        className={cx(
          "relative z-10 flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2 transition-colors",
          active ? CURRENT_ROW : "hover:bg-hover",
        )}
      >
        {/* Left: Harness Avatar + corner live StatusMark badge */}
        <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-inset shadow-hairline">
          <SessionMark s={s} size={17} />
          <span className="absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-canvas ring-1 ring-canvas">
            <StatusMark state={st} size="sm" awaiting={awaiting} waiting={backgroundWaiting(s)} />
          </span>
        </span>

        {/* Center column: Title + Time, Second line (Evidence snippet or Last message), Metadata chips */}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Line 1: Session Title + Ultracode + Pinned badge + Relative Activity Time */}
          <span className="flex min-w-0 items-center gap-1.5">
            {pinned && (
              <span className="shrink-0 text-accent" title={t("sidebar.pinned")}>
                <Icon name="pin" size={11} stroke={2.3} />
              </span>
            )}
            <span
              className={cx(
                "min-w-0 flex-1 truncate text-[13px] leading-tight",
                active || st === "unread" || st === "needs_you" ? "font-semibold text-ink" : st === "offline" ? "text-ink-3" : "font-medium text-ink-2",
              )}
            >
              {sessionTitle(s)}
            </span>
            {ultra && <UltraMark size={10} />}
            {timeLabel && (
              <span className="shrink-0 text-[11px] text-ink-3 tabular-nums group-hover/row:invisible">
                {timeLabel}
              </span>
            )}
          </span>

          {/* Line 2: Role-attributed Evidence Snippet when searching, else Last message / status line */}
          {evidence ? (
            <span data-testid="agent-evidence-snippet" className="truncate text-[11.5px] leading-4 text-ink-2">
              <span
                className={cx(
                  "mr-1 font-semibold",
                  evidence.role === "error" ? "text-red" : evidence.role === "user" ? "text-accent-ink" : "text-ink-2",
                )}
              >
                {evidence.roleLabel}
              </span>
              <span>{evidence.before}</span>
              {evidence.match && (
                <mark className="rounded-[3px] bg-accent-tint px-0.5 font-medium text-accent-ink">
                  {evidence.match}
                </mark>
              )}
              <span>{evidence.after}</span>
            </span>
          ) : (
            (line?.lead || previewText) && (
              <span className="truncate text-[11.5px] leading-4 text-ink-3">
                {line?.lead && (
                  <span className={cx("mr-1 font-medium", line.tone === "reply" ? "text-green" : "text-attention")}>
                    {line.lead}
                  </span>
                )}
                {previewText}
              </span>
            )
          )}

          {/* Line 3: Compact metadata capsules (Machine · Project · Harness · Model) */}
          <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10.5px] leading-4 text-ink-3" data-testid="agent-chatlist-chips">
            {machineLabel && (
              <span className="inline-flex max-w-[96px] items-center gap-0.5 truncate rounded bg-inset px-1.5 py-px">
                <Icon name="machine" size={9} stroke={2} />
                <span className="truncate">{machineLabel}</span>
              </span>
            )}
            {projectLabel && (
              <span className="inline-flex max-w-[110px] items-center gap-0.5 truncate rounded bg-inset px-1.5 py-px">
                <Icon name="folder" size={9} stroke={2} />
                <span className="truncate">{projectLabel}</span>
              </span>
            )}
            {harnessLabel && (
              <span className="inline-flex max-w-[96px] items-center gap-0.5 truncate rounded bg-inset px-1.5 py-px">
                <span className="truncate">{harnessLabel}</span>
              </span>
            )}
            {modelLabel && (
              <span className="inline-flex max-w-[110px] items-center gap-0.5 truncate rounded bg-inset px-1.5 py-px font-mono text-[10px]">
                <span className="truncate">{modelLabel}</span>
              </span>
            )}
            {source && (
              <span className="inline-flex items-center rounded bg-inset px-1 py-px" title={sourceName(source)}>
                {sourceName(source)}
              </span>
            )}
            {hasErr && st !== "needs_you" && (
              <span className="inline-flex items-center gap-0.5 rounded bg-red/10 px-1.5 py-px font-medium text-red">
                <Icon name="warning" size={9} stroke={2.2} />
              </span>
            )}
          </span>
        </span>
      </a>

      {/* Hover / right actions: One-click Pin/Unpin button + More menu button */}
      <div className="absolute top-1.5 right-1.5 z-20 hidden items-center gap-0.5 group-hover/row:flex [@media(hover:none)]:flex">
        <button
          type="button"
          data-testid="agent-row-pin-button"
          aria-label={pinned ? t("sidebar.unpin") : t("sidebar.pin")}
          title={pinned ? t("sidebar.unpin") : t("sidebar.pin")}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void flipPin(s);
          }}
          className={cx(
            "flex size-6 items-center justify-center rounded-[6px] bg-hover transition-colors hover:bg-hover-2",
            pinned ? "text-accent" : "text-ink-3 hover:text-ink",
          )}
        >
          <Icon name="pin" size={12} stroke={2.1} />
        </button>
        {onMenu && (
          <button
            type="button"
            aria-label={t("sidebar.agent_actions")}
            aria-haspopup="menu"
            title={t("sidebar.more")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMenu(s, e.currentTarget.parentElement ?? e.currentTarget);
            }}
            className="flex size-6 items-center justify-center rounded-[6px] bg-hover text-ink-3 hover:bg-hover-2 hover:text-ink"
          >
            <Icon name="more" size={13} />
          </button>
        )}
      </div>
    </div>
  );
});
