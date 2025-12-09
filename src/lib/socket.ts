import { io, Socket } from "socket.io-client";

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

const SOCKET_EVENTS = {
  JOIN_DIRECT: "join_direct_room",
  LEAVE_DIRECT: "leave_direct_room",
  JOIN_GROUP: "join_group_room",
  LEAVE_GROUP: "leave_group_room",
  SEND_DIRECT: "send_direct_message",
  RECEIVE_DIRECT: "receive_direct_message",
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

// Sorting the participant ids keeps both browsers in the same direct room id.
const directRoomId = (userA: string, userB: string) =>
  [userA, userB].filter(Boolean).sort().join("__");

export const connectSocket = (userId: string, metadata: Record<string, any> = {}) => {
  const socket = getSocket();
  if (!socket) return null;
  socket.auth = { userId, ...metadata };
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
};

export const disconnectSocket = () => {
  if (!socketInstance) return;
  socketInstance.disconnect();
};

export const joinDirectRoom = (userId: string, peerId: string) => {
  const socket = ensureConnection(userId);
  if (!socket) return null;
  const room = directRoomId(userId, peerId);
  socket.emit(SOCKET_EVENTS.JOIN_DIRECT, { room, userId, peerId });
  return room;
};

export const leaveDirectRoom = (userId: string, peerId: string) => {
  const socket = getSocket();
  if (!socket) return;
  const room = directRoomId(userId, peerId);
  socket.emit(SOCKET_EVENTS.LEAVE_DIRECT, { room, userId, peerId });
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
  room?: string;
  from: string;
  to: string;
  message: string;
  messageId?: string;
}) => {
  const socket = ensureConnection(payload.from);
  if (!socket) return;
  socket.emit(SOCKET_EVENTS.SEND_DIRECT, {
    ...payload,
    room: payload.room ?? directRoomId(payload.from, payload.to),
  });
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
  const socket = getSocket();
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
  disconnect: disconnectSocket,
  joinDirectRoom,
  leaveDirectRoom,
  joinGroupRoom,
  leaveGroupRoom,
  emitDirectMessage,
  emitGroupMessage,
  listenDirectMessage,
  listenGroupMessage,
};

export const realtimeEnabled = isRealtimeEnabled;
