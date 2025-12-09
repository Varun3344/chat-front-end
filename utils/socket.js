import { io } from "socket.io-client";

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:4000";

let socket = null;

export const getSocket = () => {
  if (typeof window === "undefined") {
    return null;
  }
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ["websocket"],
    });
  }
  return socket;
};

const defaultSocket = getSocket();

export default defaultSocket;
