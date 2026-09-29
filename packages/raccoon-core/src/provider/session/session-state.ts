import type { RaccoonMessage, RaccoonSession } from "@opencode-ai/raccoon-webview"

export function removeSession(
  sessions: RaccoonSession[],
  activeSessionID: string | undefined,
  activeSession: RaccoonSession | undefined,
  messages: RaccoonMessage[],
  sessionID: string,
) {
  const nextSessions = sessions.filter((session) => session.id !== sessionID)
  return {
    sessions: nextSessions,
    activeSessionID: activeSessionID === sessionID ? nextSessions[0]?.id : activeSessionID,
    activeSession: activeSessionID === sessionID
      ? nextSessions[0]
      : nextSessions.find((session) => session.id === activeSessionID) ?? activeSession,
    messages: activeSessionID === sessionID ? [] : messages,
  }
}
