import { expect, it } from "bun:test";

it("reuses an OpenIM session that is already logging in", async () => {
  const calls: string[] = [];
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
      openIMRenderApi: {
        subscribe() {},
        async imMethodsInvoke(method: string) {
          calls.push(method);
          if (method === "getLoginStatus") return { errCode: 0, data: 2 };
          if (method === "getSelfUserInfo") return { errCode: 0, data: selfInfo };
          if (method === "logout") return { errCode: 0, data: null };
          throw new Error(`Unexpected OpenIM method: ${method}`);
        },
      },
    },
  });

  try {
    const { ensureOpenIMSession, logoutOpenIMSession } = await import("./openim-sdk");
    const result = await ensureOpenIMSession({
      userID: "self",
      imToken: "token",
      expiresIn: 60,
      apiAddr: "https://openim.test",
      wsAddr: "wss://openim.test",
      rtcEnabled: false,
      capabilities: { createGroup: false },
      user: { id: "moss-user", name: "Self", email: null, orgId: "org" },
    }, {
      available: true,
      error: "",
      platformID: 5,
      dataDir: "/tmp/openim-data",
      logFilePath: "/tmp/openim.log",
      mediaCacheDir: "/tmp/openim-media",
      apiAddr: "https://openim.test",
      wsAddr: "wss://openim.test",
    });

    expect(result).toEqual({ connected: false, selfInfo });
    expect(calls).not.toContain("login");

    await logoutOpenIMSession();
    expect(calls).toContain("logout");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});
