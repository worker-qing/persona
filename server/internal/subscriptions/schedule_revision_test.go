package subscriptions

import (
	"sync"
	"testing"
	"time"

	"github.com/nwverse/persona/server/internal/connector"
)

func TestRunPreservesNewRevisionSchedule(t *testing.T) {
	for _, change := range []string{"enable", "disable", "interval", "recipe"} {
		t.Run(change, func(t *testing.T) {
			e := newEnv(t)
			sub := e.create(itemsRecipe())
			if change != "enable" {
				sub = e.turnOn(sub)
			}
			started, release := make(chan struct{}), make(chan struct{})
			var first, unblock sync.Once
			e.conn.setAnswer(func(connector.CatalogQuery) (string, error) {
				first.Do(func() {
					close(started)
					<-release
				})
				return notices(4), nil
			})
			if _, err := e.svc.RunNow(e.ctx, sub.ID, Actor{}); err != nil {
				t.Fatal(err)
			}
			running := e.svc.startDue(e.ctx)
			defer running.Wait()
			defer unblock.Do(func() { close(release) })
			select {
			case <-started:
			case <-time.After(5 * time.Second):
				t.Fatal("run did not reach connector")
			}
			// A recipe update dry-runs too; only the already-started call stays blocked.
			e.conn.setAnswer(func(connector.CatalogQuery) (string, error) { return notices(4), nil })
			patch := Patch{Revision: sub.Revision}
			switch change {
			case "enable":
				patch.ToInbox = ptr(true)
			case "disable":
				patch.ToInbox = ptr(false)
			case "interval":
				patch.IntervalSeconds = ptr(sub.IntervalSeconds * 2)
			case "recipe":
				patch.Recipe = ptr(itemsRecipe())
			}
			updated, err := e.svc.Update(e.ctx, sub.ID, patch, Actor{})
			if err != nil {
				t.Fatal(err)
			}
			unblock.Do(func() { close(release) })
			running.Wait()
			got := e.get(sub.ID)
			sameSchedule := got.NextRunAt == nil && updated.NextRunAt == nil ||
				got.NextRunAt != nil && updated.NextRunAt != nil && got.NextRunAt.Equal(*updated.NextRunAt)
			if !sameSchedule || got.Revision != updated.Revision || got.ToInbox != updated.ToInbox {
				t.Fatalf("stale run overwrote update: got next=%v rev=%d on=%v; want next=%v rev=%d on=%v",
					got.NextRunAt, got.Revision, got.ToInbox, updated.NextRunAt, updated.Revision, updated.ToInbox)
			}
			if got.LastRunAt == nil || len(e.store.Items()) != 1 || e.store.SeenCount(sub.ID) == 0 {
				t.Fatal("run result, pending item or dedup keys were lost")
			}
			if change == "enable" {
				before := e.conn.callCount()
				restarted := e.service()
				restarted.RunDue(e.ctx)
				if e.conn.callCount() != before+1 {
					t.Fatal("enabled subscription was not automatically run after restart")
				}
			}
		})
	}
}
