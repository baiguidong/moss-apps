import {
  MOSS_OPENIM_PROTOCOL,
  type AppBackendClient,
  type AppBackendContext,
} from "@moss/app-sdk";

export const MAX_AUTOMATION_MESSAGE_AGE_MS = 5 * 60 * 1000;
const SESSION_RETRY_MS = 30 * 1000;
const MAX_DELIVERY_RETRY_MS = 5 * 60 * 1000;

type Timer = ReturnType<typeof setTimeout>;

type AutomationClient = Pick<
  AppBackendClient,
  "host" | "agent" | "onHostEvent" | "onAgentEvent" | "emit" | "log" | "status"
>;

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "OpenIM 请求失败")).slice(0, 2_000);
}

export function isFreshAutomationMessage(message: Record<string, any>, now = Date.now()) {
  const sentAt = Number(message.sentAt);
  return Number.isFinite(sentAt)
    && sentAt > 0
    && Math.abs(now - sentAt) <= MAX_AUTOMATION_MESSAGE_AGE_MS;
}

export function createOpenIMAutomation(
  client: AutomationClient,
  {
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }: {
    now?: () => number;
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
  } = {},
) {
  let context: AppBackendContext | null = null;
  let sessionRefreshTimer: Timer | null = null;
  let sessionEnsurePromise: Promise<void> | null = null;
  const deliveryRetryTimers = new Map<string, Timer>();
  const deliveryAttempts = new Map<string, number>();
  const deliveriesInFlight = new Map<string, Promise<Record<string, unknown>>>();

  function scheduleSessionRefresh(delayMs: number) {
    if (!context) return;
    if (sessionRefreshTimer) clearTimer(sessionRefreshTimer);
    sessionRefreshTimer = setTimer(() => void ensureSession(), Math.max(10_000, delayMs));
    sessionRefreshTimer.unref?.();
  }

  async function ensureSession() {
    if (sessionEnsurePromise) return sessionEnsurePromise;
    sessionEnsurePromise = (async () => {
      try {
        const result = await client.host.request<{ connected: boolean; userId: string; expiresIn: number }>(
          MOSS_OPENIM_PROTOCOL,
          "session.ensure",
          {},
        );
        client.status(result.connected ? "running" : "degraded", { userId: result.userId });
        const expiresIn = Number(result.expiresIn);
        const refreshAfter = Number.isFinite(expiresIn) && expiresIn > 0
          ? Math.max(30_000, (expiresIn - 60) * 1000)
          : SESSION_RETRY_MS;
        scheduleSessionRefresh(Math.min(refreshAfter, 12 * 60 * 60 * 1000));
      } catch (error) {
        const message = errorMessage(error);
        client.log("warn", "OpenIM session is not ready", { error: message });
        client.status("degraded", { error: message });
        scheduleSessionRefresh(SESSION_RETRY_MS);
      }
    })().finally(() => {
      sessionEnsurePromise = null;
    });
    return sessionEnsurePromise;
  }

  async function acknowledgeTurn(turn: Record<string, any>, ok: boolean, details: Record<string, unknown> = {}) {
    return client.agent.request("turn.delivery.ack", {
      turnId: String(turn.id || ""),
      externalConversationId: String(turn.externalConversationId || ""),
      ok,
      ...details,
    });
  }

  function clearDeliveryRetry(turnId: string) {
    const timer = deliveryRetryTimers.get(turnId);
    if (timer) clearTimer(timer);
    deliveryRetryTimers.delete(turnId);
    deliveryAttempts.delete(turnId);
  }

  function scheduleDeliveryRetry(turnId: string) {
    if (!context || deliveryRetryTimers.has(turnId)) return;
    const attempt = (deliveryAttempts.get(turnId) || 0) + 1;
    deliveryAttempts.set(turnId, attempt);
    const delay = Math.min(MAX_DELIVERY_RETRY_MS, 2_000 * (2 ** Math.min(attempt - 1, 8)));
    const timer = setTimer(() => {
      deliveryRetryTimers.delete(turnId);
      void deliverCompletedTurn({ turnId }, true);
    }, delay);
    timer.unref?.();
    deliveryRetryTimers.set(turnId, timer);
  }

  function deliverCompletedTurn(data: Record<string, any>, retry = false) {
    const turnId = String(data.turnId || "");
    if (!turnId) return Promise.resolve({ handled: false });
    const existing = deliveriesInFlight.get(turnId);
    if (existing) return existing;
    const operation = (async () => {
      const result = await client.agent.request("turn.get", { turnId });
      const turn = record(result.turn);
      if (!turn.id) {
        clearDeliveryRetry(turnId);
        client.log("warn", "OpenIM delivery turn no longer exists", { turnId });
        return { handled: true, skipped: true };
      }
      if (turn.status !== "completed" || turn.deliveredAt) {
        clearDeliveryRetry(turnId);
        return { handled: true, skipped: true };
      }
      const text = String(data.text || turn.reviewedText || turn.resultText || "").trim();
      if (!text || !turn.externalUserId || !turn.externalConversationId) {
        await acknowledgeTurn(turn, true);
        clearDeliveryRetry(turnId);
        return { handled: true, skipped: true };
      }
      try {
        const delivery = await client.host.request<Record<string, any>>(
          MOSS_OPENIM_PROTOCOL,
          "message.send",
          {
            recipientId: String(turn.externalUserId),
            conversationId: String(turn.externalConversationId),
            text,
            idempotencyKey: turnId,
          },
        );
        await acknowledgeTurn(turn, true, {
          externalMessageId: String(delivery.serverMessageId || delivery.clientMessageId || ""),
        });
        clearDeliveryRetry(turnId);
        client.emit("ai.turn-updated", {
          turnId,
          conversationId: turn.externalConversationId,
          status: "completed",
          delivered: true,
        });
        return { handled: true, delivered: true };
      } catch (error) {
        const message = errorMessage(error);
        await acknowledgeTurn(turn, false, { error: message }).catch(() => {});
        client.emit("ai.turn-updated", {
          turnId,
          conversationId: turn.externalConversationId,
          status: "delivery_failed",
          error: message,
          retrying: true,
        });
        client.log("warn", retry ? "OpenIM reply delivery retry failed" : "OpenIM reply delivery failed", {
          turnId,
          error: message,
        });
        scheduleDeliveryRetry(turnId);
        return { handled: true, delivered: false, retrying: true };
      }
    })().finally(() => deliveriesInFlight.delete(turnId));
    deliveriesInFlight.set(turnId, operation);
    return operation;
  }

  client.onHostEvent(MOSS_OPENIM_PROTOCOL, "session.changed", async (raw) => {
    const data = record(raw);
    client.emit("openim.session-changed", data);
    if (data.connected === true) {
      client.status("running", { userId: String(data.userId || "") });
    } else {
      client.status("degraded", { error: String(data.error || "OpenIM disconnected") });
      scheduleSessionRefresh(10_000);
    }
    return { handled: true };
  });

  client.onHostEvent(MOSS_OPENIM_PROTOCOL, "message.received", async (raw) => {
    const message = record(raw);
    if (!context || !isFreshAutomationMessage(message, now())) {
      return { handled: true, ignored: "stale" };
    }
    const result = await client.agent.request("turn.start", {
      externalUserId: String(message.externalUserId || ""),
      externalConversationId: String(message.externalConversationId || ""),
      externalEventId: String(message.externalEventId || ""),
      text: String(message.text || ""),
      source: "human",
    });
    client.emit("ai.turn-updated", {
      turnId: result.turnId || null,
      conversationId: message.externalConversationId,
      status: result.status || "received",
      routing: result.routing || "human",
    });
    return { handled: true, turnId: result.turnId || null, status: result.status || "received" };
  });

  client.onAgentEvent("turn.review_requested", async (data) => {
    client.emit("ai.review-requested", data);
    const turn = record((await client.agent.request("turn.get", { turnId: String(data.turnId || "") })).turn);
    if (turn.id) await acknowledgeTurn(turn, true);
    return { handled: true };
  });

  client.onAgentEvent("turn.completed", (data) => deliverCompletedTurn(data));

  client.onAgentEvent("turn.failed", async (data) => {
    client.emit("ai.turn-updated", { ...data, status: "failed" });
    const turn = record((await client.agent.request("turn.get", { turnId: String(data.turnId || "") })).turn);
    if (turn.id) await acknowledgeTurn(turn, true);
    return { handled: true };
  });

  return {
    initialize(nextContext: AppBackendContext) {
      context = nextContext;
      void ensureSession();
    },
    shutdown() {
      context = null;
      if (sessionRefreshTimer) clearTimer(sessionRefreshTimer);
      sessionRefreshTimer = null;
      for (const timer of deliveryRetryTimers.values()) clearTimer(timer);
      deliveryRetryTimers.clear();
      deliveryAttempts.clear();
    },
    ensureSession,
    deliverCompletedTurn,
  };
}
