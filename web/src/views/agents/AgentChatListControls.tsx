import { useState } from "react";
import { t } from "../../i18n";
import {
  DEFAULT_DIMENSION_FILTERS,
  SEARCH_SCOPES,
  toggleFacetValue,
  type AgentDimensionFilters,
  type AgentFacetCounts,
  type SearchPlan,
  type SearchScope,
} from "../../lib/agent-chatlist-filter";
import { cx, Menu, useMenu, type MenuItem } from "../../ui/atoms";
import { Icon } from "../../ui/icons";
import { SearchField } from "../../ui/SearchField";

type FilterPage = "root" | "scope" | "harnesses" | "projects" | "models" | "machines";
type FacetKey = Exclude<FilterPage, "root" | "scope">;

const FACET_PAGES: { key: FacetKey; labelKey: string }[] = [
  { key: "harnesses", labelKey: "lib-agent-filter.filter_harness" },
  { key: "projects", labelKey: "lib-agent-filter.filter_project" },
  { key: "models", labelKey: "lib-agent-filter.filter_model" },
  { key: "machines", labelKey: "lib-agent-filter.filter_machine" },
];

/** How many filters are on (the Filter button's count): the query and Search as Code are not filters of their own. */
export function activeFilterCount(f: AgentDimensionFilters): number {
  return (
    f.harnesses.length + f.projects.length + f.models.length + f.machines.length + (f.pinnedOnly ? 1 : 0) + (f.scope !== "all" ? 1 : 0) + (f.since ? 1 : 0)
  );
}

// The Agents list's search (#4397): one row, the field and a Filter button whose menu holds the scope, Pinned, the four facets,
// the chat-list view and Search as Code. Chips for what is on appear only while something is, and the plan bar only with
// Search as Code on.
export function AgentDimensionFilterBar({
  filters,
  onChange: updateFilters,
  facets,
  plan,
  chatList,
  onToggleChatList,
}: {
  filters: AgentDimensionFilters;
  onChange: (next: AgentDimensionFilters) => void;
  facets: AgentFacetCounts;
  plan: SearchPlan;
  chatList: boolean;
  onToggleChatList: () => void;
}) {
  const filterMenu = useMenu();
  const [page, setPage] = useState<FilterPage>("root");
  const [editingPlan, setEditingPlan] = useState(false);
  // Query and facet edits return to a generated plan; only the plan editor owns custom code.
  const onChange = (next: AgentDimensionFilters) => updateFilters({ ...next, customPlanCode: undefined });

  const activeScope = SEARCH_SCOPES.find((s) => s.key === filters.scope) ?? SEARCH_SCOPES[0];
  const count = activeFilterCount(filters);

  const resetFilters = () => {
    onChange({ ...DEFAULT_DIMENSION_FILTERS, query: filters.query, searchAsCode: filters.searchAsCode, customPlanCode: filters.customPlanCode });
  };

  const menuItems = (): MenuItem[] => {
    const back: MenuItem = { key: "back", label: t("sidebar.back"), keepOpen: true, onSelect: () => setPage("root") };
    if (page === "scope") {
      return [
        back,
        ...SEARCH_SCOPES.map((sc, i) => ({
          key: sc.key,
          label: t(sc.labelKey),
          divider: i === 0,
          radio: true,
          checked: filters.scope === sc.key,
          keepOpen: true,
          onSelect: () => onChange({ ...filters, scope: sc.key as SearchScope }),
        })),
      ];
    }
    if (page !== "root") {
      const options = facets[page];
      const selected = filters[page];
      const allIds = options.map((o) => o.id);
      const set = (next: string[]) => onChange({ ...filters, [page]: next });
      return [
        back,
        { key: "__all__", label: t("lib-agent-filter.all"), divider: true, checked: selected.length === 0, keepOpen: true, onSelect: () => set([]) },
        ...options.map((o) => ({
          key: o.id,
          label: o.label,
          hint: String(o.count),
          checked: selected.includes(o.id),
          keepOpen: true,
          onSelect: () => set(toggleFacetValue(selected, o.id, allIds)),
        })),
      ];
    }
    const facetRows = FACET_PAGES.filter((f) => facets[f.key].length > 1 || filters[f.key].length > 0).map(
      (f, i): MenuItem => ({
        key: f.key,
        label: t(f.labelKey),
        hint: filters[f.key].length > 0 ? String(filters[f.key].length) : t("lib-agent-filter.all"),
        divider: i === 0,
        submenu: true,
        onSelect: () => setPage(f.key),
      }),
    );
    return [
      { key: "scope", label: t("lib-agent-filter.search_in"), hint: t(activeScope.labelKey), submenu: true, onSelect: () => setPage("scope") },
      {
        key: "pinned",
        label: t("lib-agent-filter.filter_pinned"),
        hint: facets.pinned > 0 ? String(facets.pinned) : undefined,
        checked: filters.pinnedOnly,
        keepOpen: true,
        onSelect: () => onChange({ ...filters, pinnedOnly: !filters.pinnedOnly }),
      },
      ...facetRows,
      { key: "chat-list", label: t("lib-agent-filter.chat_list_view"), divider: true, checked: chatList, onSelect: onToggleChatList },
      {
        key: "search-as-code",
        label: t("lib-agent-filter.search_as_code"),
        checked: filters.searchAsCode,
        onSelect: () => onChange({ ...filters, searchAsCode: !filters.searchAsCode, customPlanCode: undefined }),
      },
      ...(count > 0 ? [{ key: "reset", label: t("lib-agent-filter.reset_filters"), divider: true, onSelect: resetFilters }] : []),
    ];
  };

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.scope !== "all") {
    chips.push({ key: "scope", label: `${t("lib-agent-filter.search_in")}: ${t(activeScope.labelKey)}`, onRemove: () => onChange({ ...filters, scope: "all" }) });
  }
  if (filters.pinnedOnly) {
    chips.push({ key: "pinned", label: t("lib-agent-filter.filter_pinned"), onRemove: () => onChange({ ...filters, pinnedOnly: false }) });
  }
  for (const f of FACET_PAGES) {
    for (const id of filters[f.key]) {
      const label = facets[f.key].find((x) => x.id === id)?.label ?? id;
      chips.push({
        key: `${f.key}:${id}`,
        label: `${t(f.labelKey)}: ${label}`,
        onRemove: () => onChange({ ...filters, [f.key]: filters[f.key].filter((x) => x !== id) }),
      });
    }
  }
  if (filters.since) {
    chips.push({ key: "since", label: `since:${filters.since}`, onRemove: () => onChange({ ...filters, since: undefined }) });
  }

  const filterLabel = count > 0 ? `${t("lib-agent-filter.filter")} (${count})` : t("lib-agent-filter.filter");
  return (
    <div className="mt-1.5 flex flex-col gap-1.5 px-1" data-testid="agent-dimension-filter-bar">
      <div className="flex items-center gap-1">
        <SearchField
          tone="inset"
          size="sm"
          className="min-w-0 flex-1"
          value={filters.query}
          onChange={(q) => onChange({ ...filters, query: q })}
          placeholder={t("lib-agent-filter.search_placeholder")}
        />
        <button
          type="button"
          onClick={(e) => {
            setPage("root");
            filterMenu.open(e);
          }}
          aria-haspopup="menu"
          aria-expanded={Boolean(filterMenu.anchor)}
          aria-label={filterLabel}
          title={filterLabel}
          data-testid="agent-filter-button"
          className={cx(
            "touch-hit relative z-10 flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-control px-2 text-[11.5px] shadow-hairline transition-colors",
            count > 0 || filters.searchAsCode || chatList ? "bg-accent-tint font-medium text-accent-ink" : "bg-inset text-ink-2 hover:bg-hover hover:text-ink",
          )}
        >
          <Icon name="filter" size={13} stroke={2} />
          {count > 0 && <span className="tabular-nums">{count}</span>}
        </button>
      </div>

      {filterMenu.anchor && (
        <Menu anchor={filterMenu.anchor} onClose={filterMenu.close} align="right" width={220} header={t("lib-agent-filter.filter")} items={menuItems()} />
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[11px]" data-testid="scoped-filter-strip">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-inset py-0.5 pr-1 pl-2 text-[11px] font-medium text-ink shadow-hairline"
            >
              <span className="min-w-0 truncate">{chip.label}</span>
              <button
                type="button"
                aria-label={t("lib-agent-filter.remove_filter", { name: chip.label })}
                onClick={chip.onRemove}
                className="flex size-4 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"
              >
                <Icon name="x" size={9} stroke={2.4} />
              </button>
            </span>
          ))}
          <button
            type="button"
            data-testid="scoped-filter-reset"
            onClick={resetFilters}
            className="ml-auto shrink-0 whitespace-nowrap rounded-control px-1.5 py-0.5 text-[11px] font-medium text-accent-ink hover:bg-hover"
          >
            {t("lib-agent-filter.reset_filters")}
          </button>
        </div>
      )}

      {filters.searchAsCode && (
        <div
          data-testid="search-as-code-plan"
          className="flex flex-wrap items-center gap-1.5 rounded-control bg-inset px-2 py-1 text-[11px] shadow-hairline ring-1 ring-accent/25"
        >
          <Icon name="code" size={12} stroke={2} className="shrink-0 text-accent-ink" />
          {editingPlan ? (
            <input
              autoFocus
              data-testid="search-as-code-input"
              aria-invalid={plan.invalid || undefined}
              aria-label={t("lib-agent-filter.search_plan")}
              value={filters.customPlanCode ?? plan.code}
              onChange={(e) => updateFilters({ ...filters, customPlanCode: e.target.value })}
              onBlur={() => setEditingPlan(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") setEditingPlan(false);
              }}
              className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-ink outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingPlan(true)}
              title={`${t("lib-agent-filter.search_plan")}: ${plan.code}`}
              className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-ink hover:text-accent-ink"
            >
              {plan.code}
            </button>
          )}
          <button
            type="button"
            data-testid="search-as-code-off"
            aria-label={t("lib-agent-filter.search_as_code_off")}
            title={t("lib-agent-filter.search_as_code_off")}
            onClick={() => {
              setEditingPlan(false);
              onChange({ ...filters, searchAsCode: false, customPlanCode: undefined });
            }}
            className="flex size-4 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"
          >
            <Icon name="x" size={9} stroke={2.4} />
          </button>
          {plan.invalid && <span role="alert" className="w-full text-red">{t("lib-agent-filter.invalid_plan")}</span>}
        </div>
      )}
    </div>
  );
}
