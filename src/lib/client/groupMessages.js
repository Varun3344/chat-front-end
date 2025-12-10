import { clientApiFetch } from "./request";

/**
 * Send a group message through the Next.js proxy so API keys remain server-side.
 * @param {{ groupId: string; from: string; message: string }} payload
 */
export async function sendGroupMessageViaApi(payload) {
  return clientApiFetch("/api/chat/group/send", {
    method: "POST",
    body: payload,
  });
}

/**
 * Fetch the latest messages in a group.
 * @param {string} groupId
 */
export async function fetchGroupMessagesViaApi(groupId, options = {}) {
  return clientApiFetch("/api/chat/group/fetch", {
    method: "POST",
    body: { groupId },
    signal: options.signal,
  });
}

/**
 * List groups that the current member belongs to.
 * @param {string} memberId
 */
export async function listGroupsViaApi(memberId, options = {}) {
  const query = new URLSearchParams({ memberId }).toString();
  const url = `/api/chat/group/list?${query}`;
  return clientApiFetch(url, {
    method: "GET",
    signal: options.signal,
  });
}

/**
 * Create a new group.
 * @param {{ groupName: string; createdBy: string }} payload
 */
export async function createGroupViaApi(payload) {
  return clientApiFetch("/api/chat/group/create", {
    method: "POST",
    body: payload,
  });
}

/**
 * Add a member to a specific group.
 * @param {{ groupId: string; memberId: string }} payload
 */
export async function addGroupMemberViaApi(payload) {
  return clientApiFetch("/api/chat/group/member/add", {
    method: "POST",
    body: payload,
  });
}

/**
 * Remove a member from a group.
 * @param {{ groupId: string; memberId: string }} payload
 */
export async function removeGroupMemberViaApi(payload) {
  return clientApiFetch("/api/chat/group/member/remove", {
    method: "POST",
    body: payload,
  });
}
