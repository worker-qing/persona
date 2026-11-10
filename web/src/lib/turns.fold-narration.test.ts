import { describe, expect, it } from "vitest";
import { mergeItems, withoutFolded } from "./turns";
import type { Item } from "./types";

const note = (seq: number, narration?: boolean): Item => ({ id: `note${seq}#0`, seq, role: "assistant", kind: "text", text: `Progress ${seq}`, narration });
const fold: Item = { id: "fold:note1#0", seq: 1, role: "assistant", kind: "fold", fold: { items: 3, tools: 0, thoughts: 0, through_seq: 3, through_id: "note3#0" } };

describe("folded narration", () => {
  it.each([true, undefined])("replaces an expanded narration-only fold (flag %s)", (flag) => {
    const notes = [1, 2, 3].map((seq) => note(seq, flag));
    expect(mergeItems([fold], notes)).toEqual(notes);
    expect(mergeItems(mergeItems([fold], notes), notes)).toEqual(notes);
  });

  it.each([true, undefined])("replaces cached text with an authoritative folded page (flag %s)", (flag) => {
    const notes = [1, 2, 3].map((seq) => note(seq, flag));
    const final = note(4);
    expect(mergeItems(withoutFolded([...notes, final], [fold, final]), [fold, final])).toEqual([fold, final]);
  });

  it("preserves text outside the fold even on the same transcript line", () => {
    const before = { ...note(1), id: "line#0" };
    const inside = { ...note(1, true), id: "line#1" };
    const final = { ...note(1), id: "line#2" };
    const sameLine: Item = { ...fold, id: "fold:line#1", fold: { ...fold.fold!, through_seq: 1, through_id: "line#1" } };
    expect(mergeItems([sameLine], [before, final])).toContain(sameLine);
    expect(withoutFolded([before, inside, final], [sameLine])).toEqual([before, final]);
    expect(mergeItems([before, sameLine, final], [inside])).toEqual([before, inside, final]);
  });

  it("does not treat user text as expanded work", () => {
    const user: Item = { ...note(2), role: "user" };
    expect(mergeItems([fold], [user])).toContain(fold);
    expect(withoutFolded([user], [fold])).toEqual([user]);
  });
});
