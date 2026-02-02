import { Router } from "express";
import { db } from "../db/db.js";
import { commentary } from "../db/schema.js";
import { matchIdParamSchema } from "../validation/matches.js";
import { createCommentarySchema, listCommentaryQuerySchema } from "../validation/commentary.js";
import { desc, eq } from "drizzle-orm";

export const commentaryRouter = Router({ mergeParams: true });

const MAX_LIMIT = 100;

commentaryRouter.get("/", async (req, res) => {
  const paramsParsed = matchIdParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    return res.status(400).json({
      error: "Invalid match ID parameter",
      details: paramsParsed.error.issues,
    });
  }

  const queryParsed = listCommentaryQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    return res.status(400).json({
      error: "Invalid query parameters",
      details: queryParsed.error.issues,
    });
  }

  
  try {
    const limit = Math.min(queryParsed.data.limit ?? 100, MAX_LIMIT);
    const data = await db
      .select()
      .from(commentary)
      .where(eq(commentary.matchId, paramsParsed.data.id))
      .orderBy(desc(commentary.createdAt))
      .limit(limit);

    res.json({ data });
  } catch (err) {
    res.status(500).json({
      error: "Failed to fetch commentary",
      details: err?.message ?? String(err),
    });
  }
});

commentaryRouter.post("/", async (req, res) => {
  const paramsParsed = matchIdParamSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    return res.status(400).json({
      error: "Invalid match ID parameter",
      details: paramsParsed.error.issues,
    });
  }

  const bodyParsed = createCommentarySchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({
      error: "Invalid commentary payload",
      details: bodyParsed.error.issues,
    });
  }

  try {
    const [comment] = await db
      .insert(commentary)
      .values({
        matchId: paramsParsed.data.id,
        ...bodyParsed.data,
      })
      .returning();
    
    if (req.app.locals.broadcastCommentary) {
      req.app.locals.broadcastCommentary(comment.matchId, comment);
    }

    res.status(201).json({ data: comment });
  } catch (err) {
    res.status(500).json({
      error: "Failed to create commentary",
      details: err?.message ?? String(err),
    });
  }
});