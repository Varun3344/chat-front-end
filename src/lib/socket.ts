import type { Socket } from "socket.io-client";
import defaultSocket, {
  SOCKET_EVENTS,
  getSocket,
  joinDirectRoom,
  joinGroupRoom,
  leaveGroupRoom,
  listenForDirectMessages,
  listenForGroupMessages,
  registerUser,
  sendDirectMessage,
  sendGroupMessage,
} from "../../utils/socket";

export { SOCKET_EVENTS, getSocket, joinDirectRoom, joinGroupRoom, leaveGroupRoom, listenForDirectMessages, listenForGroupMessages, registerUser, sendDirectMessage, sendGroupMessage };
export type { Socket };
export default defaultSocket as Socket | null;
