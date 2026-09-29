// raccoon_change start - verify native Raccoon OAuth refresh
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Credential } from "../../../src/credential.js"
import { Integration } from "../../../src/integration.js"
import { RACCOON_REAUTH_REQUIRED, RaccoonOAuth } from "../../../src/raccoon/auth/oauth.js"

describe("Raccoon OAuth", () => {
  test("exchanges a browser callback and records account scope", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname
        if (path.endsWith("login_with_authorization_code"))
          return Response.json({ data: { access_token: "browser-access", refresh_token: "browser-refresh" } })
        if (path.endsWith("user_info"))
          return Response.json({ data: { id: "user-1", orgs: [{ id: "org-1", code: "team", name: "Team" }] } })
        return new Response(null, { status: 404 })
      },
    })
    try {
      const credential = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const authorization = yield* RaccoonOAuth.browser().authorize({
              serverUrl: `http://localhost:${server.port}`,
            })
            const redirect = new URL(authorization.url).searchParams.get("redirect")
            expect(redirect).toBeTruthy()
            const callback = new URL(redirect ?? "http://localhost")
            callback.searchParams.set("authorization_code", "code-1")
            const response = yield* Effect.promise(() => fetch(callback))
            expect(response.status).toBe(200)
            if (authorization.mode !== "auto") throw new Error("Unexpected OAuth mode")
            return yield* authorization.callback
          }),
        ),
      )
      expect(credential.access).toBe("browser-access")
      expect(credential.metadata?.orgCode).toBe("team")
      expect(credential.metadata?.baseURL).toBe(`http://localhost:${server.port}`)
    } finally {
      server.stop()
    }
  })

  test("signs in with encrypted phone credentials without exposing a browser URL", async () => {
    let body: Record<string, string> = {}
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname.endsWith("login_with_password")) {
          body = (await request.json()) as Record<string, string>
          return Response.json({ data: { access_token: "phone-access", refresh_token: "phone-refresh" } })
        }
        return Response.json({ data: { id: "user-1", orgs: [] } })
      },
    })
    try {
      const authorization = await Effect.runPromise(
        Effect.scoped(
          RaccoonOAuth.phone().authorize({
            serverUrl: `http://localhost:${server.port}`,
            nationCode: "86",
            phone: "13800138000",
            password: "private-password",
          }),
        ),
      )
      expect(authorization.mode).toBe("auto")
      expect(authorization.url).toBe("")
      if (authorization.mode !== "auto") throw new Error("Unexpected OAuth mode")
      const credential = await Effect.runPromise(authorization.callback)
      expect(credential.methodID).toBe(Integration.MethodID.make("phone"))
      expect(credential.access).toBe("phone-access")
      expect(credential.refresh).toBe("phone-refresh")
      expect(body.nation_code).toBe("86")
      expect(JSON.stringify(body)).not.toContain("13800138000")
      expect(JSON.stringify(body)).not.toContain("private-password")
    } finally {
      server.stop()
    }
  })

  test("does not surface a server-echoed password on phone login failure", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ message: "private-password" }, { status: 401 }),
    })
    try {
      const failure = await Effect.runPromise(
        Effect.scoped(
          RaccoonOAuth.phone().authorize({
            serverUrl: `http://localhost:${server.port}`,
            nationCode: "86",
            phone: "13800138000",
            password: "private-password",
          }).pipe(Effect.flip),
        ),
      )
      expect(String(failure)).toContain("Phone login failed: 401")
      expect(String(failure)).not.toContain("private-password")
    } finally {
      server.stop()
    }
  })

  test("persists both rotated tokens after refresh", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ data: { access_token: "new-access", refresh_token: "new-refresh" } }),
    })
    try {
      const credential = Credential.OAuth.make({
        type: "oauth",
        methodID: Integration.MethodID.make("browser"),
        access: "old-access",
        refresh: "old-refresh",
        expires: 0,
        metadata: { baseURL: `http://localhost:${server.port}` },
      })
      const result = await Effect.runPromise(RaccoonOAuth.refresh(credential))
      expect(result.access).toBe("new-access")
      expect(result.refresh).toBe("new-refresh")
      expect(result.expires).toBeGreaterThan(Date.now())
    } finally {
      server.stop()
    }
  })

  test("marks a revoked refresh token as requiring another sign-in", async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ message: "expired" }, { status: 401 }) })
    try {
      const credential = Credential.OAuth.make({
        type: "oauth",
        methodID: Integration.MethodID.make("browser"),
        access: "old-access",
        refresh: "old-refresh",
        expires: 0,
        metadata: { baseURL: `http://localhost:${server.port}` },
      })
      await expect(Effect.runPromise(RaccoonOAuth.refresh(credential))).rejects.toThrow(RACCOON_REAUTH_REQUIRED)
    } finally {
      server.stop()
    }
  })

  test("spends a rotating refresh token once across concurrent requests", async () => {
    let calls = 0
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname.endsWith("user_info")) return Response.json({ data: { id: "user-1" } })
        calls++
        await Bun.sleep(25)
        return Response.json({ data: { access_token: "shared-access", refresh_token: "shared-refresh" } })
      },
    })
    try {
      const credential = Credential.OAuth.make({
        type: "oauth",
        methodID: Integration.MethodID.make("browser"),
        access: "old-access",
        refresh: `old-refresh-${server.port}`,
        expires: 0,
        metadata: { baseURL: `http://localhost:${server.port}` },
      })
      const results = await Promise.all([
        Effect.runPromise(RaccoonOAuth.refresh(credential)),
        Effect.runPromise(RaccoonOAuth.refresh(credential)),
      ])
      expect(results.map((result) => result.refresh)).toEqual(["shared-refresh", "shared-refresh"])
      expect((await Effect.runPromise(RaccoonOAuth.refresh(credential))).refresh).toBe("shared-refresh")
      expect(calls).toBe(1)
    } finally {
      server.stop()
    }
  })
})
// raccoon_change end
