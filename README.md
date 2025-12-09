# chat-next

A lightweight WhatsApp / Microsoft Teams style playground built with the classic Next.js pages router. The landing page now acts as an account picker: select any of the four teammates to "log in" and you can chat with the remaining three inside the inbox view.

## Getting started

```bash
npm install
npm run dev
```

Visit http://localhost:3000, choose an account card, and you will be redirected to `/chat?user=<id>` with the correct persona loaded.

## Project notes

- Persona data and pair-wise seeded conversations live in `data/dummyData.js`. `seedThreadsFor(userId)` makes sure each account sees appropriate inbound/outbound directions.
- The `pages/index.js` entry renders the four accounts and routes into the chat workspace with the selected `user` query parameter.
- `pages/chat.js` enforces that a persona is picked before entering the chat, shows the logged-in user on the sidebar, and lets you send outbound messages to any of the other three teammates.
# chat-front-end
