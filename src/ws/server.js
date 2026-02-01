import { WebSocket, WebSocketServer } from "ws";
function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    console.warn("WebSocket is not open. Ready state:", socket.readyState);
    return;
  }

  socket.send(JSON.stringify(payload));
}

function broadcast(wss, payload) {
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;

    client.send(JSON.stringify(payload));
  });
}

export function attachWebSocketServer(server) {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 1 * 1024 * 1024, // 1 MB
  });

  wss.on("connection", (socket) => {
    socket.isAllive = true;
    socket.on("pong", () => {
      socket.isAllive = true;
    });

    sendJson(socket, { type: "Welcome" });

    socket.on("error", console.error);
  });

  const interval = setInterval(() => {
    wss.clients.forEach((socket) => {
      if (socket.isAllive === false) {
        console.log("Terminating unresponsive client");
        return socket.terminate();
      }

      socket.isAllive = false;
      socket.ping();
    });
  }, 30000);
  
  wss.on("close", () => {
    clearInterval(interval);
  });

  function broadcastMatchCreated(match) {
    broadcast(wss, { type: "match_created", data: match });
  }

  return { broadcastMatchCreated };
}