import { WebSocket, WebSocketServer } from "ws";
import { shouldAllowWebSocket } from "../middlewares/index.js";

const matchSubscribes = new Map();

function subscribe(matchId, socket) {
  if (!matchSubscribes.has(matchId)) {
    matchSubscribes.set(matchId, new Set());
  }
  matchSubscribes.get(matchId).add(socket);
}

function unsubscribe(matchId, socket) {
  const subscribes = matchSubscribes.get(matchId);
  if (!subscribes) return;

  subscribes.delete(socket);

  if (subscribes.size === 0) {
    matchSubscribes.delete(matchId);
  }
}

function cleanupSubscriptions(socket) {
  for (const matchId of socket.subscriptions) {
    unsubscribe(matchId, socket);
  }
}


function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    console.warn("WebSocket is not open. Ready state:", socket.readyState);
    return;
  }
  
  socket.send(JSON.stringify(payload));
}

function broadcastToAll(wss, payload) {
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    
    client.send(JSON.stringify(payload));
  });
}

function broadcastToMatch(matchId, payload) {
  const subscribes = matchSubscribes.get(matchId);
  if (!subscribes || subscribes.size === 0) return;

  const message = JSON.stringify(payload);
  for (const client of subscribes) {
    if (client.readyState !== WebSocket.OPEN) continue;

    client.send(message);
  }
}

function handleMessage(socket, data) {
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch (err) {
    console.warn("Failed to parse WebSocket message:", err);

    sendJson(socket, { type: "error", error: "Invalid JSON format" });
    return;
  }

  if (message?.type === "subscribe" && Number.isInteger(message.matchId)) {
    subscribe(message.matchId, socket);
    socket.subscriptions.add(message.matchId);

    sendJson(socket, { type: "subscribed", matchId: message.matchId });
    return;
  }
  
  if (message?.type === "unsubscribe" && Number.isInteger(message.matchId)) {
    unsubscribe(message.matchId, socket);
    socket.subscriptions.delete(message.matchId);

    sendJson(socket, { type: "unsubscribed", matchId: message.matchId });
  }
}

export function attachWebSocketServer(server) {
  const wss = new WebSocketServer({
    noServer: true,
    path: "/ws",
    maxPayload: 1 * 1024 * 1024, // 1 MB
  });

  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", async (socket, req) => {
    const { allowed, reason } = shouldAllowWebSocket(req);
    if (!allowed) {
      socket.close(1008, reason || "Policy Violation");
      return;
    }

    socket.isAllive = true;
    socket.on("pong", () => {
      socket.isAllive = true;
    });

    socket.subscriptions = new Set();

    sendJson(socket, { type: "welcome" });

    socket.on("message", (data) => {
      handleMessage(socket, data);
    });
    socket.on("error", () => {
      socket.terminate();
    });
    socket.on("close", () => {
      cleanupSubscriptions(socket);
    });

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
    broadcastToAll(wss, { type: "match_created", data: match });
  }

  function broadcastCommentary(matchId, comment) {
    broadcastToMatch(matchId, { type: "commentary", data: comment });
  }

  return { broadcastMatchCreated, broadcastCommentary };
}