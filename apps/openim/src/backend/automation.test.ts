import { describe, expect, it } from "bun:test";
import { createOpenIMAutomation, MAX_AUTOMATION_MESSAGE_AGE_MS } from "./automation";

function createFixture() {
  const hostEvents = new Map<string, (data: any) => any>();
  const agentEvents = new Map<string, (data: any) => any>();
  const emitted: Array<{ name: string; data: any }> = [];
  const statuses: Array<{ state: string; details: any }> = [];
  const agentRequests: Array<{ method: string; input: any }> = [];
  const hostRequests: Array<{ protocol: string; method: string; input: any }> = [];
  const timers: Array<{ callback: () => void; delay: number; cleared: boolean }> = [];
  let deliveryFailures = 0;
  const turn = {
    id: "turn-1",
    externalUserId: "peer-1",
    externalConversationId: "openim-user:self/direct:peer-1",
    status: "completed",
    deliveredAt: null,
    resultText: "AI reply",
  };
  const client = {
    host: {
      request: async (protocol: string, method: string, input: any) => {
        hostRequests.push({ protocol, method, input });
        if (method === "session.ensure") return { connected: true, userId: "self", expiresIn: 3600 };
        if (method === "message.send" && deliveryFailures-- > 0) throw new Error("offline");
        return { serverMessageId: "server-1" };
      },
    },
    agent: {
      request: async (method: string, input: any) => {
        agentRequests.push({ method, input });
        if (method === "turn.start") return { turnId: "turn-1", status: "queued", routing: "ai_auto" };
        if (method === "turn.get") return { turn };
        if (method === "turn.delivery.ack") return { acknowledged: input.ok };
        return {};
      },
    },
    onHostEvent: (protocol: string, name: string, handler: (data: any) => any) => hostEvents.set(`${protocol}:${name}`, handler),
    onAgentEvent: (name: string, handler: (data: any) => any) => agentEvents.set(name, handler),
    emit: (name: string, data: any) => emitted.push({ name, data }),
    log: () => {},
    status: (state: string, details: any) => statuses.push({ state, details }),
  };
  const setTimer = ((callback: () => void, delay: number) => {
    const timer = { callback, delay, cleared: false, unref() {} };
    timers.push(timer);
    return timer;
  }) as unknown as typeof setTimeout;
  const clearTimer = ((timer: any) => { timer.cleared = true }) as typeof clearTimeout;
  const automation = createOpenIMAutomation(client as any, {
    now: () => 1_700_000_000_000,
    setTimer,
    clearTimer,
  });
  return {
    automation,
    hostEvents,
    agentEvents,
    emitted,
    statuses,
    agentRequests,
    hostRequests,
    timers,
    turn,
    failDeliveries(count: number) { deliveryFailures = count },
  };
}

describe("OpenIM automation backend", () => {
  it("ignores stale messages and routes fresh direct messages through the Agent Host", async () => {
    const fixture = createFixture();
    fixture.automation.initialize({ instanceId: "default" } as any);
    await fixture.automation.ensureSession();
    const receive = fixture.hostEvents.get("moss.openim/v1:message.received")!;
    await expect(receive({
      externalUserId: "peer-1",
      externalConversationId: "openim-user:self/direct:peer-1",
      externalEventId: "message-old",
      text: "old",
      sentAt: 1_700_000_000_000 - MAX_AUTOMATION_MESSAGE_AGE_MS - 1,
    })).resolves.toMatchObject({ ignored: "stale" });
    await expect(receive({
      externalUserId: "peer-1",
      externalConversationId: "openim-user:self/direct:peer-1",
      externalEventId: "message-new",
      text: "hello",
      sentAt: 1_700_000_000_000,
    })).resolves.toMatchObject({ turnId: "turn-1", status: "queued" });
    expect(fixture.agentRequests.filter((entry) => entry.method === "turn.start")).toEqual([{
      method: "turn.start",
      input: {
        externalUserId: "peer-1",
        externalConversationId: "openim-user:self/direct:peer-1",
        externalEventId: "message-new",
        text: "hello",
        source: "human",
      },
    }]);
  });

  it("retries failed reply delivery and acknowledges only a successful send", async () => {
    const fixture = createFixture();
    fixture.automation.initialize({ instanceId: "default" } as any);
    await fixture.automation.ensureSession();
    fixture.failDeliveries(1);
    const completed = fixture.agentEvents.get("turn.completed")!;
    await expect(completed({ turnId: "turn-1", text: "AI reply" })).resolves.toMatchObject({
      delivered: false,
      retrying: true,
    });
    expect(fixture.agentRequests.filter((entry) => entry.method === "turn.delivery.ack").at(-1)?.input.ok).toBe(false);
    const retry = fixture.timers.find((timer) => timer.delay === 2_000 && !timer.cleared)!;
    retry.callback();
    await Bun.sleep(0);
    expect(fixture.hostRequests.filter((entry) => entry.method === "message.send")).toHaveLength(2);
    expect(fixture.agentRequests.filter((entry) => entry.method === "turn.delivery.ack").at(-1)?.input).toMatchObject({
      ok: true,
      externalMessageId: "server-1",
    });
    expect(fixture.emitted).toContainEqual({
      name: "ai.turn-updated",
      data: expect.objectContaining({ turnId: "turn-1", status: "completed", delivered: true }),
    });
  });

  it("marks disconnects degraded and schedules an early session refresh", async () => {
    const fixture = createFixture();
    fixture.automation.initialize({ instanceId: "default" } as any);
    await fixture.automation.ensureSession();
    const changed = fixture.hostEvents.get("moss.openim/v1:session.changed")!;
    await changed({ connected: false, userId: "self", error: "offline" });
    expect(fixture.statuses.at(-1)).toEqual({ state: "degraded", details: { error: "offline" } });
    expect(fixture.timers.some((timer) => timer.delay === 10_000)).toBe(true);
  });

  it("does not deliver a reply cancelled by manual takeover", async () => {
    const fixture = createFixture();
    fixture.automation.initialize({ instanceId: "default" } as any);
    await fixture.automation.ensureSession();
    fixture.turn.status = "cancelled";
    const completed = fixture.agentEvents.get("turn.completed")!;
    await expect(completed({ turnId: "turn-1", text: "AI reply" })).resolves.toMatchObject({
      handled: true,
      skipped: true,
    });
    expect(fixture.hostRequests.filter((entry) => entry.method === "message.send")).toHaveLength(0);
  });
});
