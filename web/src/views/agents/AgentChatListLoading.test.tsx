// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const chunk = vi.hoisted(() => {
  let reject!: (reason: Error) => void;
  const pending = new Promise<Record<string, unknown>>((_, fail) => { reject = fail; });
  const load = vi.fn(() => pending);
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  g.matchMedia = (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  return { reject, load };
});
vi.mock("./AgentChatListRow", () => chunk.load());

import { t } from "../../i18n";
import { getState, reset } from "../../lib/store";
import { AgentsList } from "../Sidebar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("loads chat-list rows only on request and contains a failed chunk without losing the filter controls", async () => {
  localStorage.clear();
  reset();
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}"))));
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  Object.assign(getState(), {
    loaded: true,
    machines: [{ id: "example", name: "Example computer", online: true }],
    sessions: { example: [
      { machine_id: "example", session_id: "one", title: "Pinned example", cwd: "/example", agent: "codex", state: "idle", status: "idle" },
      { machine_id: "example", session_id: "two", title: "Other example", cwd: "/example", agent: "codex", state: "idle", status: "idle" },
    ] },
    pins: { spaces: [], sessions: ["example/one"] },
    todosLoaded: true,
  });
  const toggle = async () => {
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="agent-filter-button"]')!.click());
    const row = [...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')]
      .find((el) => el.textContent?.includes(t("lib-agent-filter.chat_list_view")));
    expect(row).toBeTruthy();
    await act(async () => row!.click());
  };
  try {
    await act(async () => root.render(<AgentsList route={{ name: "agent-list" }} onNewAgent={() => {}} />));
    expect(chunk.load).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Pinned example");
    await toggle();
    await vi.waitFor(() => expect(chunk.load).toHaveBeenCalledTimes(1));
    expect(host.textContent).toContain(t("sidebar.loading"));
    expect(host.querySelector('[data-testid="agent-dimension-filter-bar"]')).not.toBeNull();
    await act(async () => {
      chunk.reject(new Error("Synthetic row chunk failed"));
      await vi.dynamicImportSettled();
    });
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(2);
    expect(host.textContent).toContain(t("pageboundary.error_title"));
    expect(host.querySelector('[data-testid="agent-filter-button"]')).not.toBeNull();
    await toggle();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("Pinned example");
    expect(host.textContent).toContain("Other example");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    reset();
    vi.unstubAllGlobals();
    consoleError.mockRestore();
  }
});
