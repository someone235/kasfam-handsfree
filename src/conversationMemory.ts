export type ConversationMemoryMode = "off" | "session" | "persist";

export function getConversationMemoryMode(): ConversationMemoryMode {
  const raw = String(process.env.CONVERSATION_MEMORY ?? "")
    .trim()
    .toLowerCase();

  if (raw === "persist" || raw === "on" || raw === "true" || raw === "1" || raw === "yes") {
    return "persist";
  }

  if (raw === "session" || raw === "fresh") {
    return "session";
  }

  return "off";
}
