import express from "express";
import http from "http";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import xss from "xss-clean";
import hpp from "hpp";
import mongoSanitize from "express-mongo-sanitize";
import { matchesRouter } from "./routes/matches.js";
import { attachWebSocketServer } from "./ws/server.js";
import { securityMiddleware } from "./middlewares/index.js";

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || "0.0.0.0";

const app = express();
const server = http.createServer(app);

// Apply security middlewares
app.use(helmet());
app.use(rateLimit({ windowMs: 10 * 1000, max: 100 })); // dublicate in securityMiddleware
app.use(xss());
app.use(hpp());
app.use(mongoSanitize());

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Hello from SportRTS" });
});

app.use(securityMiddleware);

app.use('/matches', matchesRouter);

const { broadcastMatchCreated } = attachWebSocketServer(server);
app.locals.broadcastMatchCreated = broadcastMatchCreated;

server.listen(PORT, HOST, () => {
  const base_url = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`Server is running on ${base_url}`);
  console.log(`WebSocket server is running on ${base_url.replace('http', 'ws')}/ws`);
});
