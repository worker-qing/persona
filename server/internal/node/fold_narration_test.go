package node

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/nwverse/persona/server/internal/host"
	"github.com/nwverse/persona/server/internal/proto"
	"github.com/nwverse/persona/server/internal/transcript"
)

func TestSessionItemsNarrationOptIn(t *testing.T) {
	path := filepath.Join(t.TempDir(), "rollout.jsonl")
	lines := []string{`{"type":"session_meta","payload":{"id":"s1","cwd":"/work/project","cli_version":"0.163.0"}}`}
	for _, id := range []string{"first", "second", "third", "final"} {
		phase := "commentary"
		if id == "final" {
			phase = "final_answer"
		}
		line, _ := json.Marshal(map[string]any{"type": "event_msg", "payload": map[string]any{
			"type": "item_completed", "item": map[string]any{"type": "AgentMessage", "id": id, "phase": phase,
				"content": []map[string]any{{"type": "Text", "text": id}}}}})
		lines = append(lines, string(line))
	}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	n := &Node{home: t.TempDir(), paths: map[string]string{}, files: map[string]*transcript.File{"s1": transcript.NewFile(path)},
		procs: map[string]*assistantProc{}, agents: map[string]host.Agent{}, state: &stateFile{Sessions: map[string]sessionState{}}}
	checkNarrationPages(t, func(params map[string]any) []proto.Item {
		t.Helper()
		b, _ := json.Marshal(params)
		out, err := n.handle(context.Background(), "session.items", b)
		if err != nil {
			t.Fatal(err)
		}
		b, _ = json.Marshal(out)
		var page struct{ Items []proto.Item }
		if err := json.Unmarshal(b, &page); err != nil {
			t.Fatal(err)
		}
		return page.Items
	})
}

func TestRuntimeItemsNarrationOptIn(t *testing.T) {
	n, _ := runtimeNode(t)
	runtime := dialRuntime(t, n, dshHello())
	runtime.answer = func(method string, params json.RawMessage) (any, error) {
		items := []proto.Item{}
		for i := 1; i <= 4; i++ {
			items = append(items, proto.Item{ID: strings.Repeat("n", i) + "#0", Seq: i, Role: "assistant", Kind: proto.KindText, Narration: i < 4, Text: "Progress"})
		}
		return map[string]any{"items": items}, nil
	}
	_ = runtime.peer.Notify("runtime.sessions", map[string]any{"sessions": []map[string]any{{"session_id": "s1", "status": "idle"}}})
	waitFor(t, "synthetic runtime listed", func() bool { _, ok := listed(t, n)["s1"]; return ok })
	checkNarrationPages(t, func(params map[string]any) []proto.Item {
		t.Helper()
		raw, err := nodeCall(t, n, "session.items", params)
		if err != nil {
			t.Fatal(err)
		}
		var page struct{ Items []proto.Item }
		if err := json.Unmarshal(raw, &page); err != nil {
			t.Fatal(err)
		}
		return page.Items
	})
}

func checkNarrationPages(t *testing.T, call func(map[string]any) []proto.Item) {
	t.Helper()
	for _, tc := range []struct {
		name   string
		params map[string]any
		folded bool
	}{
		{"legacy", map[string]any{"fold_work": true}, false},
		{"disabled", map[string]any{"fold_work": true, "fold_narration": false}, false},
		{"opted in", map[string]any{"fold_work": true, "fold_narration": true}, true},
		{"no work folding", map[string]any{"fold_narration": true}, false},
		{"catch up", map[string]any{"fold_work": true, "fold_narration": true, "after_seq": 0}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.params["session_id"], tc.params["turns"], tc.params["lazy_images"] = "s1", 2, true
			items := call(tc.params)
			want := []string{proto.KindText, proto.KindText, proto.KindText, proto.KindText}
			if tc.folded {
				want = []string{proto.KindFold, proto.KindText}
			}
			kinds := []string{}
			for _, it := range items {
				kinds = append(kinds, it.Kind)
			}
			if !reflect.DeepEqual(kinds, want) {
				t.Fatalf("got kinds %v, want %v", kinds, want)
			}
		})
	}
}
