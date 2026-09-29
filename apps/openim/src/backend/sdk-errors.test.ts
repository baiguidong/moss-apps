import { describe, expect, it } from "bun:test";
import { AppBackendClient, AppServiceError, createEnvelope, serializeError } from "@moss/app-sdk";
import { markOpenIMConversationRead, normalizeOpenIMError } from "./sdk-errors";

describe("OpenIM SDK errors", () => {
  it("treats an already-read conversation as success and preserves successful responses", async () => {
    const args: unknown[][] = [];
    const response = { errCode: 0, errMsg: "", data: undefined, operationID: "read-1" };
    const sdk = {
      markConversationMessageAsRead: async (...input: unknown[]) => {
        args.push(input);
        if (args.length > 1) throw { errCode: 10303, errMsg: "unread count has zero", operationID: "read-2" };
        return response;
      },
    };
    expect(await markOpenIMConversationRead(sdk, "conversation-1", "read-1")).toBe(response);
    await expect(markOpenIMConversationRead(sdk, "conversation-1", "read-2"))
      .resolves.toEqual({ errCode: 0, errMsg: "", data: undefined, operationID: "read-2" });
    expect(args).toEqual([["conversation-1", "read-1"], ["conversation-1", "read-2"]]);
  });

  it("propagates other failures even when the error text mentions unread counts", async () => {
    await expect(markOpenIMConversationRead({
      markConversationMessageAsRead: async () => {
        throw { errCode: 10002, errMsg: "unread count has zero", operationID: "failed-read" };
      },
    }, "conversation-1")).rejects.toMatchObject({
      code: "OPENIM_10002",
      message: "OpenIM markConversationMessageAsRead failed (10002): unread count has zero",
      details: { errCode: 10002, operationID: "failed-read" },
    });
  });

  it("does not suppress error 10303 from unrelated operations", () => {
    const error = normalizeOpenIMError({ errCode: 10303, errMsg: "operation failed" }, "sendMessage");
    expect(serializeError(error)).toMatchObject({
      code: "OPENIM_10303", message: "OpenIM sendMessage failed (10303): operation failed",
      details: { method: "sendMessage", errCode: 10303 },
    });
  });

  it("preserves Host errors and excludes arbitrary SDK response data", () => {
    const hostError = new AppServiceError("APP_HOST_UNAVAILABLE", "Server unavailable", { retryable: true });
    expect(normalizeOpenIMError(hostError, "session.ensure")).toBe(hostError);
    const error = normalizeOpenIMError({
      errCode: 10002, errMsg: "request failed", errDlt: "connection refused", data: { token: "private-token" },
    }, "getAllConversationList");
    expect(error.message).toContain("connection refused");
    expect(JSON.stringify(serializeError(error))).not.toContain("private-token");
  });

  it("returns action success for duplicate read receipts through the bundled App SDK", async () => {
    const sent: any[] = [];
    const client = new AppBackendClient({ send: (message: any) => sent.push(message) });
    client.registerAction("sdk.call", async () => markOpenIMConversationRead({
      markConversationMessageAsRead: async () => { throw { errCode: 10303, errMsg: "unread count has zero" }; },
    }, "conversation-1"));
    await client.handleMessage(createEnvelope("service.init", { generation: 1, launchToken: "launch-1" }));
    await client.handleMessage(createEnvelope("action.invoke", { name: "sdk.call" }, { id: "read-1" }));
    expect(sent.at(-1)).toMatchObject({
      type: "action.result", payload: { requestId: "read-1", result: { errCode: 0 } },
    });
  });
});
