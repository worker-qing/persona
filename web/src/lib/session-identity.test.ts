import { describe, expect, it } from "vitest";
import { sessionIdentity } from "./session-identity";
import type { Session } from "./types";

const session: Session = { machine_id: "computer-a", session_id: "thread-a", status: "idle", title: "Review the release", cwd: "/code/website/client", slot_name: "Release review", space_name: "Website" };

describe("session identity", () => {
  it("keeps the named tab, computer and full project path even for identical titles", () => {
    expect(sessionIdentity(session, "Laptop", "Laptop · Website")).toEqual({
      label: "Laptop · Release review · Website",
      path: "/code/website/client",
    });
    expect(sessionIdentity({ ...session, cwd: "/code/another/client" }, "Server").path).toBe("/code/another/client");
  });

  it("does not manufacture names or change the session", () => {
    expect(sessionIdentity({ ...session, slot_name: "", space_name: "", cwd: "" }, "Laptop")).toEqual({ label: "Laptop", path: "" });
    expect(session.title).toBe("Review the release");
  });

  it("retains a grouping hint without duplicating its machine or workspace", () => {
    expect(sessionIdentity(session, "Laptop", "Laptop · Website · feature/release").label).toBe("Laptop · Release review · Website · feature/release");
  });
});
