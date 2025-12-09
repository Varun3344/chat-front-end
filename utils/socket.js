import { io } from "socket.io-client";

const SOCKET_URL =
  process.env.NEXT_PUBLIC_CHAT_SOCKET_URL ||
  process.env.NEXT_PUBLIC_CHAT_API_BASE ||
  "http://localhost:4000";

export const SOCKET_EVENTS = {
  REGISTER_USER: "register_user",
  JOIN_DIRECT_ROOM: "join_direct_room",
  SEND_DIRECT_MESSAGE: "send_direct_message",
  RECEIVE_DIRECT_MESSAGE: "receive_direct_message",
  JOIN_GROUP_ROOM: "join_group_room",
  LEAVE_GROUP_ROOM: "leave_group_room",
  SEND_GROUP_MESSAGE: "send_group_message",
  RECEIVE_GROUP_MESSAGE: "receive_group_message",
};

const subscriptions = {
  userId: null,
  directRooms: new Map(),
  groupRooms: new Map(),
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
  instance.emit(SOCKET_EVENTS.JOIN_DIRECT_ROOM, payload);
  return payload;
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

export const sendDirectMessage = ({
  from,
  to,
  message,
  clientMessageId,
  metadata,
}) => {
  if (!from || !to || !message) return null;
  const instance = ensureSocket();
  if (!instance) return null;
  instance.emit(SOCKET_EVENTS.SEND_DIRECT_MESSAGE, {
    from,
    to,
    message,
    clientMessageId,
    metadata,
  });
  return instance;
};

export const sendGroupMessage = ({ groupId, from, message, metadata }) => {
  if (!groupId || !from || !message) return null;
  const instance = ensureSocket();
  if (!instance) return null;
  instance.emit(SOCKET_EVENTS.SEND_GROUP_MESSAGE, {
    groupId,
    from,
    message,
    metadata,
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

const defaultSocket = getSocket();

export default defaultSocket;
