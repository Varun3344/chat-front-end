import { io } from "socket.io-client";

const normalizeSocketUrl = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^wss?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^ws:/i, "wss:");
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http/i, "ws");
  }
  return `wss://${trimmed.replace(/^\/+/, "")}`;
};

const SOCKET_URL =
  normalizeSocketUrl(
    process.env.NEXT_PUBLIC_CHAT_SOCKET_URL ||
      process.env.NEXT_PUBLIC_CHAT_API_BASE
  ) || "ws://localhost:4000";

export const SOCKET_EVENTS = {
  REGISTER_USER: "register_user",
  JOIN_DIRECT_ROOM: "join_direct_room",
  LEAVE_DIRECT_ROOM: "leave_direct_room",
  SEND_DIRECT_MESSAGE: "send_direct_message",
  RECEIVE_DIRECT_MESSAGE: "receive_direct_message",
  JOIN_GROUP_ROOM: "join_group_room",
  LEAVE_GROUP_ROOM: "leave_group_room",
  SEND_GROUP_MESSAGE: "group:message",
  RECEIVE_GROUP_MESSAGE: "group:message",
  TYPING: "typing",
  DIRECT_TYPING: "typing",
  DIRECT_TYPING_FALLBACK: "direct_typing",
  GROUP_TYPING: "typing",
  GROUP_TYPING_FALLBACK: "group_typing",
  DIRECT_ATTACHMENT: "direct_attachment_uploaded",
  GROUP_ATTACHMENT: "group_attachment_uploaded",
  PRESENCE_SNAPSHOT: "presence_snapshot",
  PRESENCE_UPDATE: "user_presence",
  UNREAD_COUNTS: "unread_counts",
  GROUP_CREATED: "group:created",
  GROUP_UPDATED: "group:updated",
  GROUP_MEMBER_ADDED: "group:memberAdded",
  GROUP_MEMBER_REMOVED: "group:memberRemoved",
  FOCUS_GROUP_ROOM: "focus_group_room",
  BLUR_GROUP_ROOM: "blur_group_room",
};

const subscriptions = {
  userId: null,
  directRooms: new Map(),
  groupRooms: new Map(),
  activeDirectKey: null,
  activeGroupId: null,
};

let socket = null;

const trackUser = (userId, metadata = {}) => {
  subscriptions.userId = userId ?? subscriptions.userId;
  const authPayload = { ...(metadata || {}) };
  if (subscriptions.userId) {
    authPayload.userId = subscriptions.userId;
  }
  return authPayload;
};

const syncSubscriptions = (instance) => {
  if (!instance) return;
  if (subscriptions.userId) {
    instance.emit(SOCKET_EVENTS.REGISTER_USER, subscriptions.userId);
  }
  subscriptions.directRooms.forEach((payload) => {
    instance.emit(SOCKET_EVENTS.JOIN_DIRECT_ROOM, payload);
  });
  subscriptions.groupRooms.forEach((payload) => {
    instance.emit(SOCKET_EVENTS.JOIN_GROUP_ROOM, payload);
  });
  if (subscriptions.activeGroupId) {
    instance.emit(SOCKET_EVENTS.FOCUS_GROUP_ROOM, {
      groupId: subscriptions.activeGroupId,
      userId: subscriptions.userId ?? undefined,
    });
  }
};

export const getSocket = () => {
  if (typeof window === "undefined") {
    return null;
  }
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ["websocket"],
      autoConnect: false,
    });
    socket.on("connect", () => syncSubscriptions(socket));
  }
  return socket;
};

const ensureSocket = () => {
  const instance = getSocket();
  if (!instance) return null;
  if (!instance.connected) {
    instance.connect();
  }
  return instance;
};

export const registerUser = (userId, metadata = {}) => {
  if (!userId) return null;
  const instance = ensureSocket();
  if (!instance) return null;
  const authPayload = trackUser(userId, metadata);
  instance.auth = { ...(instance.auth || {}), ...authPayload };
  instance.emit(SOCKET_EVENTS.REGISTER_USER, userId);
  return instance;
};

export const joinDirectRoom = (userA, userB) => {
  if (!userA || !userB) return null;
  const instance = ensureSocket();
  if (!instance) return null;
  const payload = { userA, userB };
  const roomKey = `${userA}::${userB}`;
  subscriptions.directRooms.set(roomKey, payload);
  subscriptions.activeDirectKey = roomKey;
  instance.emit(SOCKET_EVENTS.JOIN_DIRECT_ROOM, payload);
  return payload;
};

export const leaveDirectRoom = (userA, userB) => {
  if (!userA || !userB) return;
  const instance = ensureSocket();
  if (!instance) return;
  const roomKey = `${userA}::${userB}`;
  subscriptions.directRooms.delete(roomKey);
  if (subscriptions.activeDirectKey === roomKey) {
    subscriptions.activeDirectKey = null;
  }
  instance.emit(SOCKET_EVENTS.LEAVE_DIRECT_ROOM, { userA, userB });
};

export const joinGroupRoom = (groupId, userId) => {
  if (!groupId) return null;
  const instance = ensureSocket();
  if (!instance) return null;
  const payload = {
    groupId,
    userId: userId || subscriptions.userId || undefined,
  };
  subscriptions.groupRooms.set(groupId, payload);
  instance.emit(SOCKET_EVENTS.JOIN_GROUP_ROOM, payload);
  return payload;
};

export const focusGroupRoom = (groupId, userId) => {
  if (!groupId) return null;
  const instance = ensureSocket();
  if (!instance) return null;
  const payload = {
    groupId,
    userId: userId || subscriptions.userId || undefined,
  };
  subscriptions.activeGroupId = groupId;
  instance.emit(SOCKET_EVENTS.FOCUS_GROUP_ROOM, payload);
  return payload;
};

export const blurGroupRoom = (userId) => {
  const instance = ensureSocket();
  if (!instance) return null;
  subscriptions.activeGroupId = null;
  instance.emit(SOCKET_EVENTS.BLUR_GROUP_ROOM, {
    userId: userId || subscriptions.userId || undefined,
  });
};

export const leaveGroupRoom = (groupId, userId) => {
  if (!groupId) return null;
  const instance = ensureSocket();
  if (!instance) return null;
  subscriptions.groupRooms.delete(groupId);
  instance.emit(SOCKET_EVENTS.LEAVE_GROUP_ROOM, {
    groupId,
    userId: userId || subscriptions.userId || undefined,
  });
};

export const sendDirectTyping = ({ from, to, isTyping }) => {
  if (!to) return null;
  const instance = ensureSocket();
  if (!instance) return null;
  instance.emit(SOCKET_EVENTS.TYPING, {
    scope: "direct",
    from: from || subscriptions.userId || undefined,
    to,
    isTyping: Boolean(isTyping),
  });
  return instance;
};

export const sendGroupTyping = ({ groupId, from, isTyping }) => {
  if (!groupId) return null;
  const instance = ensureSocket();
  if (!instance) return null;
  instance.emit(SOCKET_EVENTS.TYPING, {
    scope: "group",
    groupId,
    from: from || subscriptions.userId || undefined,
    isTyping: Boolean(isTyping),
  });
  return instance;
};

export const listenForDirectMessages = (handler) => {
  const instance = ensureSocket();
  if (!instance) return () => {};
  const listener = (payload) => {
    if (typeof handler === "function") {
      handler(payload);
    }
  };
  instance.on(SOCKET_EVENTS.RECEIVE_DIRECT_MESSAGE, listener);
  return () => {
    instance.off(SOCKET_EVENTS.RECEIVE_DIRECT_MESSAGE, listener);
  };
};

export const listenForGroupMessages = (handler) => {
  const instance = ensureSocket();
  if (!instance) return () => {};
  const listener = (payload) => {
    if (typeof handler === "function") {
      handler(payload);
    }
  };
  instance.on(SOCKET_EVENTS.RECEIVE_GROUP_MESSAGE, listener);
  return () => {
    instance.off(SOCKET_EVENTS.RECEIVE_GROUP_MESSAGE, listener);
  };
};

const createListener = (eventName) => (handler) => {
  const instance = ensureSocket();
  if (!instance || typeof handler !== "function") {
    return () => {};
  }
  const listener = (payload) => handler(payload);
  instance.on(eventName, listener);
  return () => instance.off(eventName, listener);
};

const subscribeToTypingScope = (scope) => (handler) => {
  const instance = ensureSocket();
  if (!instance || typeof handler !== "function") {
    return () => {};
  }
  const listener = (payload = {}) => {
    const payloadScope =
      payload.scope ?? (payload.groupId ? "group" : "direct");
    if (payloadScope !== scope) {
      return;
    }
    handler(payload);
  };
  instance.on(SOCKET_EVENTS.TYPING, listener);
  if (scope === "direct") {
    instance.on(SOCKET_EVENTS.DIRECT_TYPING_FALLBACK, listener);
  } else {
    instance.on(SOCKET_EVENTS.GROUP_TYPING_FALLBACK, listener);
  }
  return () => {
    instance.off(SOCKET_EVENTS.TYPING, listener);
    if (scope === "direct") {
      instance.off(SOCKET_EVENTS.DIRECT_TYPING_FALLBACK, listener);
    } else {
      instance.off(SOCKET_EVENTS.GROUP_TYPING_FALLBACK, listener);
    }
  };
};

export const listenForDirectTyping = subscribeToTypingScope("direct");
export const listenForGroupTyping = subscribeToTypingScope("group");
export const listenForDirectAttachments = createListener(SOCKET_EVENTS.DIRECT_ATTACHMENT);
export const listenForGroupAttachments = createListener(SOCKET_EVENTS.GROUP_ATTACHMENT);
export const listenForPresenceSnapshots = createListener(SOCKET_EVENTS.PRESENCE_SNAPSHOT);
export const listenForPresenceUpdates = createListener(SOCKET_EVENTS.PRESENCE_UPDATE);
export const listenForUnreadCounts = createListener(SOCKET_EVENTS.UNREAD_COUNTS);

export const listenForGroupActivity = (handler) => {
  const instance = ensureSocket();
  if (!instance || typeof handler !== "function") {
    return () => {};
  }
  const eventNames = [
    SOCKET_EVENTS.GROUP_CREATED,
    SOCKET_EVENTS.GROUP_UPDATED,
    SOCKET_EVENTS.GROUP_MEMBER_ADDED,
    SOCKET_EVENTS.GROUP_MEMBER_REMOVED,
  ];
  const listeners = eventNames.map((eventName) => {
    const listener = (payload) => handler({ eventName, payload });
    instance.on(eventName, listener);
    return () => instance.off(eventName, listener);
  });
  return () => listeners.forEach((unsubscribe) => unsubscribe());
};

const defaultSocket = getSocket();

export default defaultSocket;
