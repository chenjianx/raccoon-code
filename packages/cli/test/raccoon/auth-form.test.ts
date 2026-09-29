// raccoon_change start - reject password values in command arguments
import { test, expect } from "bun:test"
import { Effect } from "effect"
import { answerForm } from "../../src/commands/handlers/auth/form"

test("rejects secret values in command arguments without echoing them", async () => {
  const failure = await Effect.runPromise(
    answerForm([{ type: "string", key: "password", secret: true, required: true }], ["password=not-for-logs"]).pipe(
      Effect.flip,
    ),
  )
  expect(String(failure)).toContain("interactive input")
  expect(String(failure)).not.toContain("not-for-logs")
})
// raccoon_change end
