# chat-next

A lightweight WhatsApp / Microsoft Teams style playground built with the classic Next.js pages router. The landing page now acts as an account picker: select any of the four teammates to "log in" and you can chat with the remaining three inside the inbox view.

## Getting started

```bash
npm install
npm run dev
```

Visit http://localhost:3000, choose an account card, and you will be redirected to `/chat?user=<id>` with the correct persona loaded.

## Environment configuration

Copy `.env.local.example` to `.env.local` and fill in the Railway host plus the server-only keys issued by the backend. Only the base URLs are exposed to the browser (`NEXT_PUBLIC_CHAT_API_BASE` + `NEXT_PUBLIC_CHAT_SOCKET_URL`); every `CHAT_API_KEY_*` entry and `CHAT_API_BASE` stay on the server.

```bash
cp .env.local.example .env.local
# update NEXT_PUBLIC_CHAT_API_BASE, NEXT_PUBLIC_CHAT_SOCKET_URL and all CHAT_API_KEY_* entries
```

The frontend reads those values at build/runtime, so updating `.env.local` followed by `npm run dev` (or redeploying) points the UI at a different Railway deployment without code changes.

## Calling the Railway chat backend

All REST calls are proxied through Next.js API routes so the browser never sees the API keys. The `/api/chat/direct/send` handler forwards payloads to `/chat/direct/send` with the `CHAT_API_KEY_DIRECT` header. Use the helper from `src/lib/client/directMessages.js` anywhere in client code:

```js
import { fetchDirectMessagesViaApi, sendDirectMessageViaApi } from "src/lib/client/directMessages";
import { fetchGroupMessagesViaApi, listGroupsViaApi, sendGroupMessageViaApi } from "src/lib/client/groupMessages";

await sendDirectMessageViaApi({
  from: "varun",
  to: "shwetha",
  message: "Docs updated – shipping now 🚀",
  metadata: { urgent: true },
});

const history = await fetchDirectMessagesViaApi({ userA: "varun", userB: "shwetha" });
const groups = await listGroupsViaApi("varun");
await sendGroupMessageViaApi({ groupId: groups[0].id, from: "varun", message: "Morning all 👋" });
await fetchGroupMessagesViaApi(groups[0].id);
```

The promise resolves with the Railway response (or throws with the backend error message), making it easy to optimistically render a message and reconcile once the server ack returns.

## Realtime socket helpers

`utils/socket.js` (re-exported from `src/lib/socket.ts` for typed consumers) centralizes Socket.IO usage. The module takes the socket URL from `NEXT_PUBLIC_CHAT_SOCKET_URL`, automatically registers the current user, and re-joins the latest direct/group rooms every time the connection comes back.

```js
import {
  joinDirectRoom,
  joinGroupRoom,
  listenForDirectMessages,
  listenForGroupMessages,
  registerUser,
  sendDirectMessage,
  sendGroupMessage,
} from "utils/socket";

registerUser(currentUserId);
joinDirectRoom(currentUserId, peerId);
joinGroupRoom(groupId, currentUserId);

const unsubscribe = listenForDirectMessages((message) => {
  console.log("live direct message", message);
});
```

These helpers are what the `/chat` page uses for optimistic updates, so any other view can import the same functions to stay in sync with the Railway Socket.IO server.

## Project notes

- Persona data and pair-wise seeded conversations live in `data/dummyData.js`. `seedThreadsFor(userId)` makes sure each account sees appropriate inbound/outbound directions.
- The `pages/index.js` entry renders the four accounts and routes into the chat workspace with the selected `user` query parameter.
- `pages/chat.js` enforces that a persona is picked before entering the chat, shows the logged-in user on the sidebar, and lets you send outbound messages to any of the other three teammates.
# chat-front-end
