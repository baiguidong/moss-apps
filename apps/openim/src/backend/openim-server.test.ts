import { afterEach, describe, expect, it } from "bun:test";
import { createOpenIMServerService, openIMUserId } from "./openim-server";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function context() {
  return {
    target: { type: "server", id: "server-default" },
    instanceId: "moss.openim--default",
    owner: { scope: "org", orgId: "org-1", userId: null, key: "org:org-1" },
    config: {
      apiUrl: "https://openim.example.com",
      wsUrl: "wss://openim.example.com/msg_gateway",
      namespace: "moss",
    },
    secrets: { secret: "admin-secret" },
  } as any;
}

describe("OpenIM Server service", () => {
  it("returns one directory page instead of aggregating the organization", async () => {
    const requests: Array<{ method: string; input: any }> = [];
    const service = createOpenIMServerService({
      account: {
        request: async (method: string, input: any) => {
          requests.push({ method, input });
          if (method === "identity.current") return {
            source: "server",
            user: { id: "user-1", name: "User", status: "active" },
            organization: { id: "org-1", name: "Org" },
          };
          return {
            users: [{ id: "user-2", name: "Other", status: "active" }],
            departments: [],
            nextCursor: "next-page",
            revision: "revision-1",
          };
        },
        on: () => () => {},
      },
      log: () => {},
      status: () => {},
    } as any);
    service.initialize(context());

    await expect(service.listDirectory({ cursor: "page-1", limit: 50 })).resolves.toMatchObject({
      users: [{ id: "user-2", openimUserID: openIMUserId("moss", "org-1", "user-2") }],
      nextCursor: "next-page",
    });
    expect(requests).toEqual([
      { method: "identity.current", input: {} },
      { method: "directory.list", input: { limit: 50, cursor: "page-1" } },
    ]);
  });

  it("revokes every OpenIM platform session when a directory user is disabled", async () => {
    let userChanged: ((data: any) => Promise<void>) | null = null;
    const bodies: any[] = [];
    globalThis.fetch = (async (input, init) => {
      const pathname = new URL(String(input)).pathname;
      const body = JSON.parse(String(init?.body || "{}"));
      if (pathname === "/auth/get_admin_token") {
        return new Response(JSON.stringify({ errCode: 0, data: { token: "admin-token", expireTimeSeconds: 3600 } }));
      }
      if (pathname === "/auth/force_logout") bodies.push(body);
      return new Response(JSON.stringify({ errCode: 0, data: {} }));
    }) as typeof fetch;
    const service = createOpenIMServerService({
      account: {
        request: async () => { throw new Error("not used"); },
        on: (_name: string, handler: (data: any) => Promise<void>) => {
          userChanged = handler;
          return () => { userChanged = null; };
        },
      },
      log: () => {},
      status: () => {},
    } as any);
    service.initialize(context());

    const notifyUserChanged = userChanged as unknown as (data: any) => Promise<void>;
    await notifyUserChanged({ user: { id: "user-2", status: "disabled" } });
    expect(bodies).toHaveLength(8);
    expect(bodies.map(body => body.platformID)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(bodies.map(body => body.userID))).toEqual(new Set([openIMUserId("moss", "org-1", "user-2")]));
  });
});
