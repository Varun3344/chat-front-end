import { clientApiFetch } from "./request";

/**
 * Calls the Next.js proxy for /chat/direct/send so that API keys stay on the server.
 * @param {{ from: string; to: string; message: string; metadata?: Record<string, any>; }} payload
 */
export async function sendDirectMessageViaApi(payload) {
  return clientApiFetch("/api/chat/direct/send", {
    method: "POST",
    body: payload,
  });
}

/**
 * Fetch the latest direct conversation between two users.
 * @param {{ userA: string; userB: string }} payload
 */
export async function fetchDirectMessagesViaApi(payload, options = {}) {
  return clientApiFetch("/api/chat/direct/fetch", {
    method: "POST",
    body: payload,
    signal: options.signal,
  });
}

/**
 * Delete a direct message by ID via the Next.js proxy.
 * @param {{ messageId: string }} payload
 */
export async function deleteDirectMessageViaApi(payload) {
  return clientApiFetch("/api/chat/direct/delete", {
    method: "POST",
    body: payload,
  });
}
