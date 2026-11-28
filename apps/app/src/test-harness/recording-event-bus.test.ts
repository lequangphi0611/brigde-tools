import { describe, expect, it } from "vitest";
import type { DomainEvent } from "../shared/events/domain-event.ts";
import { RecordingEventBus } from "./recording-event-bus.ts";

const ev = (issueId: string): DomainEvent => ({ type: "IssueDiscovered", projectId: "p", issueId, occurredAt: "t" });

describe("RecordingEventBus", () => {
  it("ghi lại event theo thứ tự", () => {
    const bus = new RecordingEventBus();
    bus.publish([ev("A")]);
    bus.publish([ev("B")]);
    expect(bus.published.map((e) => (e as { issueId: string }).issueId)).toEqual(["A", "B"]);
  });
  it("failWhen: ném lỗi và không ghi gì của lô đó", () => {
    const bus = new RecordingEventBus();
    bus.failWhen = (e) => e.type === "IssueDiscovered" && e.issueId === "N1";
    expect(() => bus.publish([ev("N2"), ev("N1")])).toThrow();
    expect(bus.published).toEqual([]);
    bus.publish([ev("N2")]);
    expect(bus.published).toHaveLength(1);
  });
  it("reset xoá event và điều kiện lỗi", () => {
    const bus = new RecordingEventBus();
    bus.failWhen = () => true;
    bus.reset();
    bus.publish([ev("A")]);
    bus.reset();
    expect(bus.published).toEqual([]);
  });
});
