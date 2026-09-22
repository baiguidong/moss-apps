import { describe, expect, it } from "bun:test";
import { createOpenIMAutomation, MAX_AUTOMATION_MESSAGE_AGE_MS } from "./automation";

function createFixture() {
  const agentEvents = new Map<string, (data: any) => any>();
  const emitted: Array<{ name: string; data: any }> = [];
  const statuses: Array<{ state: string; details: any }> = [];
  const agentRequests: Array<{ method: string; input: any }> = [];
  const sent: any[] = [];
  const markedRead: string[] = [];
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
    agent: {
      request: async (method: string, input: any) => {
        agentRequests.push({ method, input });
        if (method === "turn.start") return { turnId: "turn-1", status: "queued", routing: "ai_auto" };
        if (method === "turn.get") return { turn };
        if (method === "turn.delivery.ack") return { acknowledged: input.ok };
        return {};
      },
      on: (name: string, handler: (data: any) => any) => {
        agentEvents.set(name, handler);
        return () => agentEvents.delete(name);
      },
    },
    emit: (name: string, data: any) => emitted.push({ name, data }),
    log: () => {},
    status: (state: string, details: any) => statuses.push({ state, details }),
  };
  const openIM = {
    automationExtension: "moss.openim/automation-v1",
    ensureSession: async () => ({
      userID: "self",
      expiresIn: 3_600,
      rtcEnabled: false,
      capabilities: { createGroup: false },
      user: { id: "user", name: "Self", email: null, orgId: "org" },
    }),
    sendText: async (input: any) => {
      sent.push(input);
      if (deliveryFailures-- > 0) throw new Error("offline");
      return { serverMessageId: "server-1" };
    },
    markConversationRead: async (conversationId: string) => {
      markedRead.push(conversationId);
      return { read: true };
    },
    normalizeMessages: (event: string, data: any) => event === "message" ? [data] : [],
    normalizeSessionEvent: (event: string, data: any) => event === "session" ? data : null,
    onEvent: () => () => {},
  };
  const setTimer = ((callback: () => void, delay: number) => {
    const timer = { callback, delay, cleared: false, unref() {} };
    timers.push(timer);
    return timer;
  }) as unknown as typeof setTimeout;
  const clearTimer = ((timer: any) => { timer.cleared = true; }) as typeof clearTimeout;
  const automation = createOpenIMAutomation(client as any, openIM as any, {
    now: () => 1_700_000_000_000,
    setTimer,
    clearTimer,
  });
  return {
    automation,
    agentEvents,
    emitted,
    statuses,
    agentRequests,
    sent,
    markedRead,
    timers,
    turn,
    failDeliveries(count: number) { deliveryFailures = count; },
  };
}

describe("OpenIM automation backend", () => {
  it("ignores stale messages and routes fresh direct messages through the Agent Host", async () => {
    const fixture = createFixture();
    fixture.automation.initialize({ instanceId: "default" } as any);
    await fixture.automation.ensureSession();
    await expect(fixture.automation.handleMessage({
      externalUserId: "peer-1",
      externalConversationId: "openim-user:self/direct:peer-1",
      externalEventId: "message-old",
      text: "old",
      sentAt: 1_700_000_000_000 - MAX_AUTOMATION_MESSAGE_AGE_MS - 1,
      contentType: 101,
      sessionType: 1,
    })).resolves.toMatchObject({ ignored: "stale" });
    await expect(fixture.automation.handleMessage({
      externalUserId: "peer-1",
      externalConversationId: "openim-user:self/direct:peer-1",
      externalEventId: "message-new",
      text: "hello",
      sentAt: 1_700_000_000_000,
      contentType: 101,
      sessionType: 1,
    })).resolves.toMatchObject({ turnId: "turn-1", status: "queued" });
    expect(fixture.agentRequests.filter((entry) => entry.method === "turn.start")).toEqual([{
      method: "turn.start",
      input: {
        externalUserId: "peer-1",
        externalConversationId: "openim-user:self/direct:peer-1",
        externalEventId: "message-new",
        defaultConversationId: "openim-user:self/*",
        text: "hello",
        source: "human",
      },
    }]);
    expect(fixture.markedRead).toEqual(["openim-user:self/direct:peer-1"]);
  });

  it("does not start an Agent turn for another Moss AI's automated reply", async () => {
    const fixture = createFixture();
    fixture.automation.initialize({ instanceId: "default" } as any);
    await fixture.automation.ensureSession();
    await expect(fixture.automation.handleMessage({
      externalUserId: "peer-1",
      externalConversationId: "openim-user:self/direct:peer-1",
      externalEventId: "message-ai",
      text: "AI reply",
      sentAt: 1_700_000_000_000,
      contentType: 101,
      sessionType: 1,
      extension: "moss.openim/automation-v1",
    })).resolves.toEqual({ handled: true, ignored: "automated" });
    expect(fixture.agentRequests.filter((entry) => entry.method === "turn.start")).toHaveLength(0);
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
    expect(fixture.sent).toHaveLength(2);
    expect(fixture.sent[0]?.extension).toBe("moss.openim/automation-v1");
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
    await fixture.automation.handleOpenIMEvent("session", { connected: false, userId: "self", error: "offline" });
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
    expect(fixture.sent).toHaveLength(0);
  });
});
