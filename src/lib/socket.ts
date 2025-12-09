import { io, Socket } from "socket.io-client";

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "";

const SOCKET_EVENTS = {
  REGISTER_USER: "register_user",
  JOIN_DIRECT: "join_direct_room",
  SEND_DIRECT: "send_direct_message",
  RECEIVE_DIRECT: "receive_direct_message",
  JOIN_GROUP: "join_group_room",
  LEAVE_GROUP: "leave_group_room",
  SEND_GROUP: "send_group_message",
  RECEIVE_GROUP: "receive_group_message",
} as const;

let socketInstance: Socket | null = null;
const isRealtimeEnabled = Boolean(SOCKET_URL);

const getSocket = () => {
  if (!isRealtimeEnabled) {
    return null;
  }
  if (!socketInstance) {
    socketInstance = io(SOCKET_URL, {
      autoConnect: false,
      transports: ["websocket"],
    });
  }
  return socketInstance;
};

type SocketAuth = Record<string, any> & { userId?: string };

const getAuthPayload = (auth: Socket["auth"]): SocketAuth => {
  if (!auth || typeof auth === "function") {
    return {};
  }
  return auth as SocketAuth;
};

const ensureConnection = (userId?: string) => {
  const socket = getSocket();
  if (!socket) return null;
  const authPayload = getAuthPayload(socket.auth);
  if (userId && authPayload.userId !== userId) {
    socket.auth = { ...authPayload, userId };
  }
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
};

export const connectSocket = (userId: string, metadata: Record<string, any> = {}) => {
  const socket = getSocket();
  if (!socket) return null;
  socket.auth = { userId, ...metadata };
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
};

export const registerUser = (userId: string) => {
  if (!userId) return null;
  const socket = ensureConnection(userId);
  if (!socket) return null;
  socket.emit(SOCKET_EVENTS.REGISTER_USER, userId);
  return socket;
};

export const disconnectSocket = () => {
  if (!socketInstance) return;
  socketInstance.disconnect();
};

export const joinDirectRoom = (userId: string, peerId: string) => {
  const socket = ensureConnection(userId);
  if (!socket) return null;
  const payload = { userA: userId, userB: peerId };
  socket.emit(SOCKET_EVENTS.JOIN_DIRECT, payload);
  return payload;
};

export const joinGroupRoom = (groupId: string, userId?: string) => {
  const socket = ensureConnection(userId);
  if (!socket) return;
  socket.emit(SOCKET_EVENTS.JOIN_GROUP, { groupId, userId });
};

export const leaveGroupRoom = (groupId: string, userId?: string) => {
  const socket = getSocket();
  if (!socket) return;
  socket.emit(SOCKET_EVENTS.LEAVE_GROUP, { groupId, userId });
};

export const emitDirectMessage = (payload: {
  from: string;
  to: string;
  message: string;
  clientMessageId?: string;
  metadata?: Record<string, any>;
}) => {
  const socket = ensureConnection(payload.from);
  if (!socket) return;
  socket.emit(SOCKET_EVENTS.SEND_DIRECT, payload);
};

export const emitGroupMessage = (payload: {
  groupId: string;
  from: string;
  message: string;
  messageId?: string;
}) => {
  const socket = ensureConnection(payload.from);
  if (!socket) return;
  socket.emit(SOCKET_EVENTS.SEND_GROUP, payload);
};

export const listenDirectMessage = (handler: (payload: any) => void) => {
  const socket = ensureConnection();
  if (!socket) return () => {};
  socket.on(SOCKET_EVENTS.RECEIVE_DIRECT, handler);
  return () => socket.off(SOCKET_EVENTS.RECEIVE_DIRECT, handler);
};

export const listenGroupMessage = (handler: (payload: any) => void) => {
  const socket = getSocket();
  if (!socket) return () => {};
  socket.on(SOCKET_EVENTS.RECEIVE_GROUP, handler);
  return () => socket.off(SOCKET_EVENTS.RECEIVE_GROUP, handler);
};

export const socket = {
  get instance() {
    return socketInstance;
  },
  connect: connectSocket,
  registerUser,
  disconnect: disconnectSocket,
  joinDirectRoom,
  joinGroupRoom,
  leaveGroupRoom,
  emitDirectMessage,
  emitGroupMessage,
  listenDirectMessage,
  listenGroupMessage,
};

export const realtimeEnabled = isRealtimeEnabled;
