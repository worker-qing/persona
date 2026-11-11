package subscriptions

import (
	"context"
	"testing"
	"time"

	"github.com/nwverse/persona/server/internal/db"
)

// Run the DBStore merge callback against the latest serialized row without a database.
type runCommitDB struct {
	DB
	row   db.SubscriptionRow
	seen  []db.SubscriptionSeenRow
	items []db.SubscriptionItemRow
}

func (d *runCommitDB) CommitSubscriptionRun(_ context.Context, _ string,
	merge func([]byte, int64) ([]byte, error), seen []db.SubscriptionSeenRow,
	items []db.SubscriptionItemRow, _ time.Time) error {
	data, err := merge(d.row.Data, d.row.Revision)
	if err != nil {
		return err
	}
	d.row.Data, d.seen, d.items = data, seen, items
	return nil
}

func TestDBStoreCommitRunPreservesNewSchedule(t *testing.T) {
	now := time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)
	for _, change := range []string{"same_revision", "enabled", "disabled", "rescheduled"} {
		t.Run(change, func(t *testing.T) {
			out := Subscription{ID: "sub_test", Revision: 1, SinceAt: &now, LastRunAt: &now,
				Runs: []Run{{At: now}}, NextRunAt: ptr(now.Add(time.Hour)), RunState: StateFailing}
			current := Subscription{ID: out.ID, Revision: 2, ToInbox: true, NextRunAt: &now, RunState: StateOK}
			switch change {
			case "same_revision":
				current.Revision = out.Revision
			case "enabled":
				out.NextRunAt = nil
			case "disabled":
				current.ToInbox, current.NextRunAt = false, nil
			case "rescheduled":
				current.NextRunAt = ptr(now.Add(2 * time.Hour))
			}
			row, err := toRow(current)
			if err != nil {
				t.Fatal(err)
			}
			d := &runCommitDB{row: row}
			err = NewDBStore(d).CommitRun(t.Context(), RunCommit{Sub: out, Revision: out.Revision, Now: now,
				Seen: []Seen{{UID: "item", ContentHash: "hash"}}, Items: []Item{{UID: "item"}}})
			if err != nil {
				t.Fatal(err)
			}
			got, err := fromRow(d.row)
			if err != nil {
				t.Fatal(err)
			}
			want := current
			if change == "same_revision" {
				want.NextRunAt, want.RunState = out.NextRunAt, out.RunState
			}
			equal := got.NextRunAt == nil && want.NextRunAt == nil ||
				got.NextRunAt != nil && want.NextRunAt != nil && got.NextRunAt.Equal(*want.NextRunAt)
			if !equal || got.RunState != want.RunState || got.ToInbox != current.ToInbox {
				t.Fatalf("schedule/state overwritten: got next=%v state=%s on=%v; want next=%v state=%s on=%v",
					got.NextRunAt, got.RunState, got.ToInbox, want.NextRunAt, want.RunState, current.ToInbox)
			}
			if got.SinceAt == nil || !got.SinceAt.Equal(now) || got.LastRunAt == nil || len(got.Runs) != 1 ||
				len(d.seen) != 1 || d.seen[0].UID != "item" || len(d.items) != 1 || d.items[0].UID != "item" {
				t.Fatal("run cursor/history/seen/items were not retained")
			}
		})
	}
}
