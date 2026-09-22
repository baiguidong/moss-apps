import { expect, it } from "bun:test";

it("uses the App action bridge without exposing OpenIM credentials to the UI", async () => {
  const calls: Array<{ name: string; input: any }> = [];
  const selfInfo = {
    createTime: 0,
    ex: "",
    faceURL: "",
    nickname: "Self",
    userID: "self",
    globalRecvMsgOpt: 0,
    addFriendPermission: 0,
  };
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      mossApp: {
        instances: { list: async () => [{ id: "moss.openim--default", enabled: true }] },
        actions: {
          invoke: async (_instanceId: string, name: string, input: any) => {
            calls.push({ name, input });
            if (name !== "sdk.call") throw new Error(`Unexpected action: ${name}`);
            if (input.method === "getLoginStatus") return { errCode: 0, data: 2 };
            if (input.method === "getSelfUserInfo") return { errCode: 0, data: selfInfo };
            if (input.method === "logout") return { errCode: 0, data: null };
            throw new Error(`Unexpected OpenIM method: ${input.method}`);
          },
        },
        events: { on: () => () => {} },
      },
    },
  });

  try {
    const { ensureOpenIMSession, logoutOpenIMSession } = await import("./openim-sdk");
    const result = await ensureOpenIMSession({
      userID: "self",
      expiresIn: 60,
      rtcEnabled: false,
      capabilities: { createGroup: false },
      user: { id: "moss-user", name: "Self", email: null, orgId: "org" },
    });

    expect(result).toEqual({ connected: false, selfInfo });
    expect(calls.map((entry) => entry.input.method)).toEqual(["getLoginStatus", "getSelfUserInfo"]);
    expect(JSON.stringify(calls)).not.toContain("token");

    await logoutOpenIMSession();
    expect(calls.at(-1)?.input.method).toBe("logout");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});
