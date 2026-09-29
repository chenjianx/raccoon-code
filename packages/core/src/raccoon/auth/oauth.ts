// raccoon_change start - register native browser OAuth and rotated Raccoon token refresh
import { Deferred, Duration, Effect } from "effect"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { RaccoonConnection } from "./connection.js"
import { loginWithPhone } from "./phone.js"

const methodID = Integration.MethodID.make("browser")
const callbackTimeout = Duration.minutes(5)
export const RACCOON_REAUTH_REQUIRED = "RACCOON_REAUTH_REQUIRED"
const refreshInflight = new Map<string, Promise<Credential.OAuth>>()
const refreshResults = new Map<string, { value: Credential.OAuth; expiresAt: number }>()

type Tokens = {
  data?: { access_token?: string; refresh_token?: string }
  error?: { message?: string }
  message?: string
  details?: string
}
type User = { data?: { id?: string; orgs?: Array<{ id?: string; code?: string; name: string }> } }

export namespace RaccoonOAuth {
  export const phone = () =>
    ({
      integrationID: Integration.ID.make("raccoon"),
      method: {
        id: Integration.MethodID.make("phone"),
        type: "oauth",
        label: "Phone and password",
        form: [
          {
            type: "string",
            key: "serverUrl",
            title: "Raccoon server URL",
            format: "uri",
            default: RaccoonConnection.baseURL(),
          },
          {
            type: "string",
            key: "nationCode",
            title: "Country code",
            required: true,
            default: "86",
            options: [
              { value: "86", label: "+86" },
              { value: "852", label: "+852" },
              { value: "853", label: "+853" },
              { value: "81", label: "+81" },
            ],
          },
          { type: "string", key: "phone", title: "Phone number", required: true },
          { type: "string", key: "password", title: "Password", required: true, secret: true },
        ],
      },
      authorize: (answer) =>
        Effect.gen(function* () {
          const baseURL = RaccoonConnection.baseURL(typeof answer.serverUrl === "string" ? answer.serverUrl : undefined)
          const nationCode = answer.nationCode
          const phone = answer.phone
          const password = answer.password
          if (typeof nationCode !== "string" || typeof phone !== "string" || typeof password !== "string") {
            return yield* Effect.fail(new Error("Phone number and password are required"))
          }
          const tokens = yield* Effect.tryPromise({
            try: (signal) => loginWithPhone({ baseUrl: baseURL, nationCode, phone, password, signal }),
            catch: (cause) => cause,
          })
          const user = yield* userInfo(baseURL, tokens.access).pipe(Effect.orElseSucceed(() => undefined))
          const credential = Credential.OAuth.make({
            type: "oauth",
            methodID: Integration.MethodID.make("phone"),
            access: tokens.access,
            refresh: tokens.refresh,
            expires: expires(tokens.access),
            metadata: {
              baseURL,
              ...(user?.data?.orgs?.[0]?.code ? { orgCode: user.data.orgs[0].code } : {}),
              ...((user?.data?.orgs?.[0]?.code ?? user?.data?.orgs?.[0]?.id ?? user?.data?.id)
                ? { accountId: user?.data?.orgs?.[0]?.code ?? user?.data?.orgs?.[0]?.id ?? user?.data?.id }
                : {}),
            },
          })
          return {
            mode: "auto" as const,
            url: "",
            instructions: "Completing phone sign-in…",
            callback: Effect.succeed(credential),
          }
        }),
      refresh,
    }) satisfies IntegrationOAuthMethodRegistration

  export const browser = () =>
    ({
      integrationID: Integration.ID.make("raccoon"),
      method: {
        id: methodID,
        type: "oauth",
        label: "Browser sign-in",
        form: [
          {
            type: "string",
            key: "serverUrl",
            title: "Raccoon server URL",
            format: "uri",
            default: RaccoonConnection.baseURL(),
          },
        ],
      },
      authorize: (answer) =>
        Effect.gen(function* () {
          const baseURL = RaccoonConnection.baseURL(typeof answer.serverUrl === "string" ? answer.serverUrl : undefined)
          const state = crypto.randomUUID()
          const result = yield* Deferred.make<Credential.OAuth, Error>()
          const { createServer } = yield* Effect.promise(() => import("node:http"))
          const server = createServer((request, response) => {
            const url = new URL(request.url ?? "/", "http://localhost")
            if (url.pathname !== "/auth/callback") {
              response.writeHead(404).end("Not found")
              return
            }
            const returnedState = url.searchParams.get("state")
            const code = url.searchParams.get("authorization_code") ?? url.searchParams.get("code")
            if ((returnedState && returnedState !== state) || !code) {
              const message =
                returnedState && returnedState !== state ? "Invalid OAuth state" : "Missing authorization code"
              response.writeHead(400, { "Content-Type": "text/plain" }).end(message)
              Effect.runFork(Deferred.fail(result, new Error(message)))
              return
            }
            void Effect.runPromise(exchange(baseURL, code)).then(
              (credential) => {
                response
                  .writeHead(200, { "Content-Type": "text/html" })
                  .end("Authorization successful. You may close this window.")
                Effect.runFork(Deferred.succeed(result, credential))
              },
              (error) => {
                const message = error instanceof Error ? error.message : String(error)
                response.writeHead(400, { "Content-Type": "text/plain" }).end(message)
                Effect.runFork(Deferred.fail(result, new Error(message)))
              },
            )
          })
          const port = yield* Effect.callback<number, Error>((resume) => {
            server.once("error", (error) => resume(Effect.fail(error)))
            server.listen(0, "127.0.0.1", () => {
              const address = server.address()
              resume(
                typeof address === "object" && address
                  ? Effect.succeed(address.port)
                  : Effect.fail(new Error("Cannot open OAuth callback listener")),
              )
            })
          })
          yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
          const redirect = `http://127.0.0.1:${port}/auth/callback?state=${encodeURIComponent(state)}`
          const url = new URL(`${baseURL}/login`)
          url.searchParams.set("ide", "CLI")
          url.searchParams.set("appname", "Raccoon")
          url.searchParams.set("redirect", redirect)
          return {
            mode: "auto" as const,
            url: url.href,
            instructions: `Open ${url.href} in your browser and complete sign-in.`,
            callback: Deferred.await(result).pipe(Effect.timeout(callbackTimeout)),
          }
        }),
      refresh,
    }) satisfies IntegrationOAuthMethodRegistration

  export function refresh(credential: Credential.OAuth) {
    const key = `${RaccoonConnection.baseURLFromMetadata(credential.metadata)}::${credential.refresh}`
    return Effect.tryPromise({
      try: () => {
        const previous = refreshResults.get(key)
        if (previous && previous.expiresAt > Date.now()) return Promise.resolve(previous.value)
        const active = refreshInflight.get(key)
        if (active) return active
        const promise = Effect.runPromise(refreshOnce(credential))
          .then((value) => {
            refreshResults.set(key, { value, expiresAt: Date.now() + 60_000 })
            if (refreshResults.size > 64) refreshResults.delete(refreshResults.keys().next().value ?? key)
            return value
          })
          .finally(() => refreshInflight.delete(key))
        refreshInflight.set(key, promise)
        return promise
      },
      catch: (cause) => cause,
    })
  }

  const refreshOnce = Effect.fn("RaccoonOAuth.refreshOnce")(function* (credential: Credential.OAuth) {
    const baseURL = RaccoonConnection.baseURLFromMetadata(credential.metadata)
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(`${baseURL}/api/plugin/auth/v1/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: credential.refresh }),
          signal,
          redirect: "error",
        }),
      catch: (cause) => cause,
    })
    const json = (yield* Effect.promise(() => response.json().catch(() => ({})))) as Tokens
    if (!response.ok) {
      const message = json.error?.message ?? json.message ?? json.details ?? `Token refresh failed: ${response.status}`
      const reauth = [400, 401, 403].includes(response.status)
      return yield* Effect.fail(new Error(reauth ? `${RACCOON_REAUTH_REQUIRED}: ${message}` : message))
    }
    const access = json.data?.access_token
    const refresh = json.data?.refresh_token
    if (!access || !refresh) return yield* Effect.fail(new Error("Token refresh failed: missing tokens"))
    const user = yield* userInfo(baseURL, access).pipe(Effect.orElseSucceed(() => undefined))
    return Credential.OAuth.make({
      ...credential,
      access,
      refresh,
      expires: expires(access),
      metadata: {
        ...credential.metadata,
        baseURL,
        ...(RaccoonConnection.orgCode(user?.data) ? { orgCode: RaccoonConnection.orgCode(user?.data) } : {}),
      },
    })
  })
}

function exchange(baseURL: string, code: string) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(`${baseURL}/api/plugin/auth/v1/login_with_authorization_code`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authorization_code: code }),
          signal,
          redirect: "error",
        }),
      catch: (cause) => cause,
    })
    const json = (yield* Effect.promise(() => response.json().catch(() => ({})))) as Tokens
    if (!response.ok)
      return yield* Effect.fail(new Error(json.error?.message ?? json.message ?? `Login failed: ${response.status}`))
    const access = json.data?.access_token
    const refresh = json.data?.refresh_token
    if (!access || !refresh) return yield* Effect.fail(new Error("Login failed: missing tokens"))
    const user = yield* userInfo(baseURL, access).pipe(Effect.orElseSucceed(() => undefined))
    return Credential.OAuth.make({
      type: "oauth",
      methodID,
      access,
      refresh,
      expires: expires(access),
      metadata: {
        baseURL,
        ...(user?.data?.orgs?.[0]?.code ? { orgCode: user.data.orgs[0].code } : {}),
        ...((user?.data?.orgs?.[0]?.code ?? user?.data?.orgs?.[0]?.id ?? user?.data?.id)
          ? { accountId: user?.data?.orgs?.[0]?.code ?? user?.data?.orgs?.[0]?.id ?? user?.data?.id }
          : {}),
      },
    })
  })
}

function userInfo(baseURL: string, access: string) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(`${baseURL}/api/plugin/auth/v1/user_info`, {
        headers: { Authorization: `Bearer ${access}` },
        signal,
        redirect: "error",
      })
      if (!response.ok) throw new Error(`Failed to fetch user info: ${response.status}`)
      return (await response.json()) as User
    },
    catch: (cause) => cause,
  })
}

function expires(token: string) {
  const payload = token.split(".")[1]
  if (!payload) return Date.now() + 60 * 60 * 1000
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp?: number }
    return value.exp ? value.exp * 1000 : Date.now() + 60 * 60 * 1000
  } catch {
    return Date.now() + 60 * 60 * 1000
  }
}
// raccoon_change end
