import express from "express";
import { matchesRouter } from "./routes/matches.js";

const app = express();
const PORT = 8000;

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Hello from SportRTS" });
});

app.use('/matches', matchesRouter);

app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});
