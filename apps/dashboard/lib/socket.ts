"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001";

let socketInstance: Socket | null = null;

function getSocket(token?: string): Socket {
  if (!socketInstance || !socketInstance.connected) {
    socketInstance = io(SOCKET_URL, {
      auth: { token: token ?? "" },
      autoConnect: false,
      transports: ["websocket", "polling"],
    });
  }
  return socketInstance;
}

export function useSocket(token?: string, orgId?: string) {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) return;

    const socket = getSocket(token);
    socketRef.current = socket;

    const onConnect = () => {
      setIsConnected(true);
      if (orgId) {
        socket.emit("join:org", { org_id: orgId });
      }
    };

    const onDisconnect = () => setIsConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    if (!socket.connected) {
      socket.connect();
    } else {
      setIsConnected(true);
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [token, orgId]);

  return { socket: socketRef.current, isConnected };
}

export { getSocket };
