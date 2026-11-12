package subscriptions

import (
	"testing"
	"time"
)

func TestCommitRunCombinesBaselineAndScheduleRevision(t *testing.T) {
	now := time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)
	for _, changedBaseline := range []bool{false, true} {
		for _, memory := range []bool{false, true} {
			name := "db"
			if memory {
				name = "memory"
			}
			if changedBaseline {
				name += "/new_baseline"
			} else {
				name += "/same_baseline"
			}
			t.Run(name, func(t *testing.T) {
				current := Subscription{ID: "sub_test", Revision: 2, ToInbox: true,
					Baseline: &now, NextRunAt: ptr(now.Add(2 * time.Hour)), RunState: StateOK}
				if changedBaseline {
					current.Baseline = ptr(now.Add(time.Minute))
				}
				commit := RunCommit{Revision: 1, Baseline: &now, Now: now,
					Sub: Subscription{ID: current.ID, Revision: 1, LastRunAt: &now,
						NextRunAt: ptr(now.Add(time.Hour)), RunState: StateFailing}}
				var got Subscription
				if memory {
					store := NewMemStore()
					store.subs[current.ID] = current
					if err := store.CommitRun(t.Context(), commit); err != nil {
						t.Fatal(err)
					}
					got = store.subs[current.ID]
				} else {
					row, err := toRow(current)
					if err != nil {
						t.Fatal(err)
					}
					d := &runCommitDB{row: row}
					if err := NewDBStore(d).CommitRun(t.Context(), commit); err != nil {
						t.Fatal(err)
					}
					got, err = fromRow(d.row)
					if err != nil {
						t.Fatal(err)
					}
				}
				if !sameTime(got.NextRunAt, current.NextRunAt) || got.Revision != current.Revision || got.RunState != current.RunState {
					t.Fatalf("stale run overwrote current schedule/state: %+v", got)
				}
				if !sameTime(got.LastRunAt, &now) {
					t.Fatal("run timing was lost")
				}
				if changedBaseline {
					if !sameTime(got.Baseline, current.Baseline) {
						t.Fatal("stale run cleared a newer baseline")
					}
				} else if got.Baseline != nil {
					t.Fatal("completed baseline was not cleared")
				}
			})
		}
	}
}
