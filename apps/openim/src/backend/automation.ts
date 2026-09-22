import type { AppBackendClient, AppBackendContext } from "@moss/app-sdk";
import { openIMDefaultConversationIdFor } from "../lib/conversation-identifiers";
import type { OpenIMAutomationMessage, PublicOpenIMProfile } from "./openim-client";

export const MAX_AUTOMATION_MESSAGE_AGE_MS = 5 * 60 * 1000;
const SESSION_RETRY_MS = 30 * 1000;
const MAX_DELIVERY_RETRY_MS = 5 * 60 * 1000;

type Timer = ReturnType<typeof setTimeout>;

type AutomationClient = Pick<AppBackendClient, "agent" | "emit" | "log" | "status">;

type OpenIMClient = {
  ensureSession(): Promise<PublicOpenIMProfile>;
  sendText(input: {
    recipientId: string;
    conversationId: string;
    text: string;
    idempotencyKey: string;
    extension?: string;
  }): Promise<Record<string, unknown>>;
  markConversationRead(conversationId: string): Promise<Record<string, unknown>>;
  normalizeMessages(event: string, data: unknown): OpenIMAutomationMessage[];
  normalizeSessionEvent(event: string, data: unknown): { connected: boolean; userId: string; error?: string } | null;
  onEvent(listener: (event: string, data: unknown) => void | Promise<void>): () => void;
  automationExtension: string;
};

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "OpenIM request failed")).slice(0, 2_000);
}

export function isFreshAutomationMessage(message: Record<string, any>, now = Date.now()) {
  const sentAt = Number(message.sentAt);
  return Number.isFinite(sentAt)
    && sentAt > 0
    && Math.abs(now - sentAt) <= MAX_AUTOMATION_MESSAGE_AGE_MS;
}

export function createOpenIMAutomation(
  client: AutomationClient,
  openIM: OpenIMClient,
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
  let unsubscribeOpenIM: (() => void) | null = null;
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
        const result = await openIM.ensureSession();
        client.status("running", { connected: true, userId: result.userID });
        const expiresIn = Number(result.expiresIn);
        const refreshAfter = Number.isFinite(expiresIn) && expiresIn > 0
          ? Math.max(30_000, (expiresIn - 60) * 1_000)
          : SESSION_RETRY_MS;
        scheduleSessionRefresh(Math.min(refreshAfter, 12 * 60 * 60 * 1_000));
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
      const reply = String(data.text || turn.reviewedText || turn.resultText || "").trim();
      if (!reply || !turn.externalUserId || !turn.externalConversationId) {
        await acknowledgeTurn(turn, true);
        clearDeliveryRetry(turnId);
        return { handled: true, skipped: true };
      }
      try {
        const delivery = await openIM.sendText({
          recipientId: String(turn.externalUserId),
          conversationId: String(turn.externalConversationId),
          text: reply,
          idempotencyKey: turnId,
          extension: openIM.automationExtension,
        });
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

  async function handleMessage(message: OpenIMAutomationMessage) {
    if (!context || !isFreshAutomationMessage(message, now())) return { handled: true, ignored: "stale" };
    if (message.extension === openIM.automationExtension) {
      client.log("info", "Ignored an automated OpenIM message to prevent an AI reply loop", {
        externalEventId: message.externalEventId,
      });
      return { handled: true, ignored: "automated" };
    }
    const result = await client.agent.request("turn.start", {
      externalUserId: message.externalUserId,
      externalConversationId: message.externalConversationId,
      externalEventId: message.externalEventId,
      defaultConversationId: openIMDefaultConversationIdFor(message.externalConversationId) || undefined,
      text: message.text,
      source: "human",
    });
    if ((result as Record<string, any>).routing !== "human") {
      await openIM.markConversationRead(message.externalConversationId).catch((error) => {
        client.log("warn", "Unable to mark the Agent-handled OpenIM conversation as read", {
          error: errorMessage(error),
          externalConversationId: message.externalConversationId,
        });
      });
    }
    client.emit("ai.turn-updated", {
      turnId: (result as Record<string, any>).turnId || null,
      conversationId: message.externalConversationId,
      status: (result as Record<string, any>).status || "received",
      routing: (result as Record<string, any>).routing || "human",
    });
    return {
      handled: true,
      turnId: (result as Record<string, any>).turnId || null,
      status: (result as Record<string, any>).status || "received",
    };
  }

  async function handleOpenIMEvent(event: string, data: unknown) {
    const sessionEvent = openIM.normalizeSessionEvent(event, data);
    if (sessionEvent && !sessionEvent.connected) scheduleSessionRefresh(10_000);
    for (const message of openIM.normalizeMessages(event, data)) await handleMessage(message);
  }

  client.agent.on("turn.review_requested", async (data) => {
    client.emit("ai.review-requested", data);
    const turn = record((await client.agent.request("turn.get", { turnId: String(data.turnId || "") })).turn);
    if (turn.id) await acknowledgeTurn(turn, true);
    return { handled: true };
  });

  client.agent.on("turn.completed", (data) => deliverCompletedTurn(data));

  client.agent.on("turn.failed", async (data) => {
    client.emit("ai.turn-updated", { ...data, status: "failed" });
    const turn = record((await client.agent.request("turn.get", { turnId: String(data.turnId || "") })).turn);
    if (turn.id) await acknowledgeTurn(turn, true);
    return { handled: true };
  });

  return {
    initialize(nextContext: AppBackendContext) {
      context = nextContext;
      unsubscribeOpenIM = openIM.onEvent(handleOpenIMEvent);
      void ensureSession();
    },
    shutdown() {
      context = null;
      unsubscribeOpenIM?.();
      unsubscribeOpenIM = null;
      if (sessionRefreshTimer) clearTimer(sessionRefreshTimer);
      sessionRefreshTimer = null;
      for (const timer of deliveryRetryTimers.values()) clearTimer(timer);
      deliveryRetryTimers.clear();
      deliveryAttempts.clear();
    },
    ensureSession,
    handleMessage,
    handleOpenIMEvent,
    deliverCompletedTurn,
  };
}
