package transcript

import (
	"reflect"
	"strings"
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
	folded := FoldWorkWithNarration(work)
	if len(folded) != 2 || folded[0].ID != item.ID || folded[0].Kind != proto.KindText || folded[0].Text != item.Text || folded[1].Kind != proto.KindFold {
		t.Fatalf("the reply must survive compact pages while work remains folded: %+v", folded)
	}
}

func TestCodexNarrationPreservesTurnAnswerAggregation(t *testing.T) {
	meta := &Meta{Codex: true, LastText: "Previous answer."}
	ParseLine(1, []byte(`{"type":"event_msg","payload":{"type":"task_started","turn_id":"first"}}`), meta)
	message := func(seq int, id, phase, text string) proto.Item {
		t.Helper()
		line := `{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"AgentMessage","id":` +
			quote(id) + `,"phase":` + quote(phase) + `,"content":[{"type":"Text","text":` + quote(text) + `}]}}}`
		return only(t, ParseLine(seq, []byte(line), meta))
	}
	note := message(2, "note", "commentary", "Checking the result.")
	if note.Kind != proto.KindText || !note.Narration || meta.TurnAnswer() != "Previous answer." {
		t.Fatalf("commentary changed the answer or stopped being visible: %+v answer=%q", note, meta.TurnAnswer())
	}
	message(3, "report", "final", "The first check passed.")
	message(4, "closing", "final", "All checks completed.")
	message(5, "note-after", "commentary", "Preparing the next step.")
	want := "The first check passed.\n\nAll checks completed."
	if meta.TurnAnswer() != want || meta.LastText != "All checks completed." {
		t.Fatalf("lost upstream answer aggregation: answer=%q last=%q", meta.TurnAnswer(), meta.LastText)
	}
	// The upstream turn boundary clears both answer parts and the item-id deduplication set.
	ParseLine(6, []byte(`{"type":"event_msg","payload":{"type":"task_started","turn_id":"second"}}`), meta)
	message(7, "report", "final", "The next turn's answer.")
	if meta.TurnAnswer() != "The next turn's answer." {
		t.Fatalf("previous turn leaked into the answer: %q", meta.TurnAnswer())
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
	folded := FoldWorkWithNarration(items)
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
	folded = FoldWorkWithNarration(items)
	for _, it := range folded {
		if it.ID == "newest" {
			t.Fatal("superseded progress should be inside the execution summary")
		}
	}
	if folded[len(folded)-1].ID != "final" {
		t.Fatal("the final answer was folded")
	}
}

func TestNarrationFoldingRequiresClientOptIn(t *testing.T) {
	for _, count := range []int{1, 3} {
		var items []proto.Item
		for i := 0; i < count; i++ {
			text := "A short progress note."
			if count == 1 {
				text = strings.Repeat("Progress. ", 512)
			}
			items = append(items, proto.Item{ID: strings.Repeat("n", i+1) + "#0", Seq: i + 1, Role: "assistant", Kind: proto.KindText, Narration: true, Text: text})
		}
		items = append(items, proto.Item{ID: "answer#0", Seq: count + 1, Role: "assistant", Kind: proto.KindText, Text: "Done."})
		if got := FoldWork(items); !reflect.DeepEqual(got, items) {
			t.Fatalf("legacy clients must keep narration as ordinary text: %+v", got)
		}
		got := FoldWorkWithNarration(items)
		if len(got) != 2 || got[0].Kind != proto.KindFold || got[0].Fold.Items != count || got[1].ID != "answer#0" {
			t.Fatalf("opted-in client should get a narration-only fold and answer: %+v", got)
		}
	}
}
