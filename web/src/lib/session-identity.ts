import { shortPath, tabLabel } from "./format";
import type { Session } from "./types";

/** Keep location separate from the task title, including names from grouped and flat lists. */
export function sessionIdentity(s: Session, machine: string, hint?: string): { label: string; path: string } {
  const names = [machine, s.slot_name ? tabLabel(s) : "", s.space_name, ...(hint?.split(" · ") ?? [])];
  const unique = [...new Set(names.map((name) => name?.trim()).filter((name): name is string => Boolean(name)))];
  return { label: unique.join(" · "), path: shortPath(s.cwd) };
}
