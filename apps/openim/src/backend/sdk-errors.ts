import { AppServiceError } from "@moss/app-sdk";
import type OpenIMSDK from "./native-sdk.mjs";

const UNREAD_COUNT_ALREADY_ZERO = 10303;

export function normalizeOpenIMError(error: unknown, method: string): Error {
  if (error instanceof Error) return error;
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const message = [value.errDlt, value.errMsg, value.message, error]
    .find((item): item is string => typeof item === "string" && Boolean(item.trim()));
  const code = value.errCode || value.code;
  return new AppServiceError(
    code ? `OPENIM_${code}` : "OPENIM_SDK_ERROR",
    `OpenIM ${method} failed${code ? ` (${code})` : ""}: ${message || "Unknown SDK error"}`,
    { method, errCode: value.errCode, errMsg: value.errMsg, errDlt: value.errDlt, operationID: value.operationID },
  );
}

export async function markOpenIMConversationRead(
  sdk: Pick<OpenIMSDK, "markConversationMessageAsRead">,
  ...args: Parameters<OpenIMSDK["markConversationMessageAsRead"]>
) {
  try {
    return await sdk.markConversationMessageAsRead(...args);
  } catch (error) {
    // The UI and automation can mark the same conversation concurrently.
    // OpenIM reports this already-completed operation as a rejected response.
    if (error && typeof error === "object" && "errCode" in error && error.errCode === UNREAD_COUNT_ALREADY_ZERO) {
      return {
        errCode: 0,
        errMsg: "",
        data: undefined,
        operationID: "operationID" in error ? String(error.operationID || "") : "",
      };
    }
    throw normalizeOpenIMError(error, "markConversationMessageAsRead");
  }
}
