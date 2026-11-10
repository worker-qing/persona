package transcript

import (
	"testing"

	"github.com/nwverse/persona/server/internal/proto"
)

func TestCodexCommentaryRemainsUserFacingText(t *testing.T) {
	meta := &Meta{Codex: true, LastText: "The previous answer."}
	line := `{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"AgentMessage","id":"note","phase":"commentary","content":[{"type":"Text","text":"**Progress**\n\nThe first check passed. Next I will inspect the remaining cases."}]}}}`
	item := only(t, ParseLine(1, []byte(line), meta))
	if item.Kind != proto.KindText || item.Role != "assistant" || !item.Narration {
		t.Fatalf("user-facing commentary was classified as %s/%s", item.Role, item.Kind)
	}
	if meta.LastText != "The previous answer." {
		t.Fatal("commentary overwrote the last-answer metadata")
	}
	reasoning := `{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"Reasoning","id":"thought","summary_text":["Checking the alternatives."]}}}`
	thought := only(t, ParseLine(2, []byte(reasoning), meta))
	if thought.Kind != proto.KindThinking {
		t.Fatalf("reasoning should remain collapsible, got %s", thought.Kind)
	}
	work := []proto.Item{
		item,
		thought,
		{ID: "call", Seq: 3, Kind: proto.KindToolUse, ToolUseID: "tool", ToolName: "Read"},
		{ID: "result", Seq: 4, Kind: proto.KindToolResult, ToolUseID: "tool"},
	}
	folded := FoldWork(work)
	if len(folded) != 2 || folded[0].ID != item.ID || folded[0].Kind != proto.KindText || folded[0].Text != item.Text || folded[1].Kind != proto.KindFold {
		t.Fatalf("the reply must survive compact pages while work remains folded: %+v", folded)
	}
}

func TestFoldNarrationKeepsLatestTextPerExchange(t *testing.T) {
	narration := func(id string, seq int) proto.Item {
		return proto.Item{ID: id, Seq: seq, Role: "assistant", Kind: proto.KindText, Narration: true, Text: "**Progress:** " + id}
	}
	items := []proto.Item{
		narration("old", 1), narration("older", 2), narration("interrupted", 3),
		{ID: "user", Seq: 4, Role: "user", Kind: proto.KindText, Text: "Continue the checks."},
		narration("next", 5), narration("later", 6), narration("newest", 7),
		{ID: "thought", Seq: 8, Role: "assistant", Kind: proto.KindThinking, Text: "Inspecting the remaining case."},
	}
	folded := FoldWork(items)
	for _, id := range []string{"interrupted", "newest"} {
		found := false
		for _, it := range folded {
			found = found || (it.ID == id && it.Kind == proto.KindText && it.Narration)
		}
		if !found {
			t.Fatalf("lost latest narration %s: %+v", id, folded)
		}
	}
	// A final answer replaces the progress text outside the summary.
	items = append(items, proto.Item{ID: "final", Seq: 9, Role: "assistant", Kind: proto.KindText, Text: "All checks passed."})
	folded = FoldWork(items)
	for _, it := range folded {
		if it.ID == "newest" {
			t.Fatal("superseded progress should be inside the execution summary")
		}
	}
	if folded[len(folded)-1].ID != "final" {
		t.Fatal("the final answer was folded")
	}
}
