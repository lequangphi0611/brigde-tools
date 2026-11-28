import { describe, expect, it } from "vitest";
import type { DomainEvent } from "../../events/domain-event.ts";
import { InProcessEventBus } from "./in-process-event-bus.ts";
import { openAppStorage } from "../sqlite/app-storage.ts";
import { SqliteUnitOfWork } from "../sqlite/sqlite-unit-of-work.ts";

const discovered = (issueId: string): DomainEvent => ({ type: "IssueDiscovered", projectId: "p", issueId, occurredAt: "2026-01-01T00:00:00.000Z" });
const changed = (issueId: string): DomainEvent => ({ type: "ContentChanged", projectId: "p", issueId, contentIds: ["title:" + issueId], reason: "new_issue", occurredAt: "2026-01-01T00:00:00.000Z" });

describe("InProcessEventBus", () => {
  it("gọi handler theo type, tuần tự theo thứ tự đăng ký và thứ tự event", () => {
    const bus = new InProcessEventBus();
    const calls: string[] = [];
    bus.subscribe("IssueDiscovered", (e) => calls.push(`h1:${e.issueId}`));
    bus.subscribe("ContentChanged", (e) => calls.push(`c:${e.issueId}:${e.reason}`));
    bus.subscribe("IssueDiscovered", (e) => calls.push(`h2:${e.issueId}`));
    bus.publish([discovered("A"), changed("A"), discovered("B")]);
    expect(calls).toEqual(["h1:A", "h2:A", "c:A:new_issue", "h1:B", "h2:B"]);
  });
  it("không có handler thì không làm gì", () => {
    expect(() => new InProcessEventBus().publish([discovered("A")])).not.toThrow();
  });
  it("handler ném lỗi thì publish ném lại nguyên vẹn và dừng handler sau", () => {
    const bus = new InProcessEventBus();
    const boom = new Error("boom");
    const after: string[] = [];
    bus.subscribe("IssueDiscovered", () => {
      throw boom;
    });
    bus.subscribe("IssueDiscovered", (e) => after.push(e.issueId));
    expect(() => bus.publish([discovered("A")])).toThrow(boom);
    expect(after).toEqual([]);
  });
});

describe("SqliteUnitOfWork + InProcessEventBus (ADR-0011)", () => {
  function setup() {
    const db = openAppStorage({ path: ":memory:" });
    db.raw.exec("CREATE TABLE probe_uow (id TEXT PRIMARY KEY) STRICT");
    const bus = new InProcessEventBus();
    bus.subscribe("IssueDiscovered", (e) => {
      db.raw.prepare("INSERT INTO probe_uow (id) VALUES (?)").run("handler:" + e.issueId);
    });
    const count = () => (db.raw.prepare("SELECT COUNT(*) AS n FROM probe_uow").get() as { n: number }).n;
    return { db, bus, uow: new SqliteUnitOfWork(db), count };
  }

  it("trả kết quả của fn và commit cả phần lưu lẫn phần handler ghi", () => {
    const { db, bus, uow, count } = setup();
    const result = uow.run(() => {
      db.raw.prepare("INSERT INTO probe_uow (id) VALUES (?)").run("state:A");
      bus.publish([discovered("A")]);
      return 42;
    });
    expect(result).toBe(42);
    expect(count()).toBe(2);
  });
  it("handler ném lỗi thì rollback cả phần lưu, lỗi gốc được ném lại", () => {
    const { db, bus, uow, count } = setup();
    bus.subscribe("IssueDiscovered", () => {
      throw new Error("handler lỗi");
    });
    expect(() =>
      uow.run(() => {
        db.raw.prepare("INSERT INTO probe_uow (id) VALUES (?)").run("state:A");
        bus.publish([discovered("A")]);
      }),
    ).toThrow("handler lỗi");
    expect(count()).toBe(0);
    expect(db.raw.isTransaction).toBe(false);
  });
  it("lỗi một đơn vị không chặn đơn vị sau", () => {
    const { db, uow, count } = setup();
    expect(() =>
      uow.run(() => {
        db.raw.prepare("INSERT INTO probe_uow (id) VALUES (?)").run("x");
        throw new Error("x");
      }),
    ).toThrow();
    uow.run(() => db.raw.prepare("INSERT INTO probe_uow (id) VALUES (?)").run("y"));
    expect(count()).toBe(1);
  });
});
