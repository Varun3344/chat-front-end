import { io } from "socket.io-client";

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:4000";

export const SOCKET_EVENTS = {
  REGISTER_USER: "register_user",
  JOIN_DIRECT_ROOM: "join_direct_room",
  SEND_DIRECT_MESSAGE: "send_direct_message",
  RECEIVE_DIRECT_MESSAGE: "receive_direct_message",
};

let socket = null;

export const getSocket = () => {
  if (typeof window === "undefined") {
    return null;
  }
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ["websocket"],
      autoConnect: false,
    });
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

export const registerUser = (userId) => {
  if (!userId) return null;
  const instance = ensureSocket();
  if (!instance) return null;
  instance.emit(SOCKET_EVENTS.REGISTER_USER, userId);
  return instance;
};

export const joinDirectRoom = (userA, userB) => {
  if (!userA || !userB) return null;
  const instance = ensureSocket();
  if (!instance) return null;
  const payload = { userA, userB };
  instance.emit(SOCKET_EVENTS.JOIN_DIRECT_ROOM, payload);
  return payload;
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

const defaultSocket = getSocket();

export default defaultSocket;
