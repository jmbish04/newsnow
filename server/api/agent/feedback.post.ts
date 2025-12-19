/**
 * POST /api/agent/feedback
 *
 * Allows the frontend to provide feedback on articles
 * This updates the article's tags, ranking, and trains the AI agents
 *
 * Example payload:
 * {
 *   "article_id": 123,
 *   "feedback_type": "upvote" | "downvote" | "saved" | "archived" | "tag_added" | "tag_removed",
 *   "score": 85,  // Optional: manual ranking override
 *   "tags": ["rust", "performance"],  // Optional: tags to add
 *   "collection_id": 5,  // Optional: add to collection
 *   "notes": "Great insights on memory management"  // Optional: user notes
 * }
 */

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)

    if (!body || !body.article_id) {
      return {
        success: false,
        error: "Missing \"article_id\" in request body",
      }
    }

    if (!body.feedback_type) {
      return {
        success: false,
        error: "Missing \"feedback_type\" in request body",
      }
    }

    const validFeedbackTypes = ["upvote", "downvote", "saved", "archived", "tag_added", "tag_removed"]
    if (!validFeedbackTypes.includes(body.feedback_type)) {
      return {
        success: false,
        error: `Invalid feedback_type. Must be one of: ${validFeedbackTypes.join(", ")}`,
      }
    }

    const db = event.context.cloudflare?.env?.NEWSNOW_DB
    const agentNamespace = event.context.cloudflare?.env?.ARTICLE_AGENT

    if (!db) {
      return {
        success: false,
        error: "Database not available",
      }
    }

    // Record feedback in database
    const now = Date.now()
    await db
      .prepare("INSERT INTO article_feedback (article_id, feedback_type, feedback_data, created_at) VALUES (?, ?, ?, ?)")
      .bind(
        body.article_id,
        body.feedback_type,
        JSON.stringify(body),
        now,
      )
      .run()

    // Update article based on feedback type
    if (body.feedback_type === "upvote") {
      // Increase ranking by 10 (capped at 100)
      await db
        .prepare("UPDATE articles SET ranking = MIN(100, ranking + 10), updated_at = ? WHERE id = ?")
        .bind(now, body.article_id)
        .run()
    } else if (body.feedback_type === "downvote") {
      // Decrease ranking by 10 (floored at 1)
      await db
        .prepare("UPDATE articles SET ranking = MAX(1, ranking - 10), updated_at = ? WHERE id = ?")
        .bind(now, body.article_id)
        .run()
    } else if (body.feedback_type === "saved") {
      // Increase ranking slightly and mark as saved
      await db
        .prepare("UPDATE articles SET ranking = MIN(100, ranking + 5), status = ?, updated_at = ? WHERE id = ?")
        .bind("read", now, body.article_id)
        .run()
    } else if (body.feedback_type === "archived") {
      // Mark as archived
      await db
        .prepare("UPDATE articles SET status = ?, updated_at = ? WHERE id = ?")
        .bind("archived", now, body.article_id)
        .run()
    }

    // Manual ranking override
    if (body.score !== undefined && body.score >= 1 && body.score <= 100) {
      await db
        .prepare("UPDATE articles SET ranking = ?, updated_at = ? WHERE id = ?")
        .bind(body.score, now, body.article_id)
        .run()
    }

    // Add tags
    if (body.tags && Array.isArray(body.tags)) {
      for (const tagName of body.tags) {
        // Get or create tag
        let tag = await db
          .prepare("SELECT id FROM article_tags WHERE name = ? LIMIT 1")
          .bind(tagName)
          .first<{ id: number }>()

        if (!tag) {
          const newTag = await db
            .prepare("INSERT INTO article_tags (name, is_active, created_at) VALUES (?, 1, ?) RETURNING id")
            .bind(tagName, now)
            .first<{ id: number }>()

          tag = newTag
        }

        if (tag) {
          // Assign tag to article
          await db
            .prepare("INSERT OR IGNORE INTO article_tag_map (article_id, tag_id, created_at) VALUES (?, ?, ?)")
            .bind(body.article_id, tag.id, now)
            .run()
        }
      }
    }

    // Add to collection
    if (body.collection_id) {
      await db
        .prepare("INSERT OR IGNORE INTO collection_items (collection_id, article_id, notes, created_at) VALUES (?, ?, ?, ?)")
        .bind(body.collection_id, body.article_id, body.notes || "", now)
        .run()
    }

    // Send feedback to the ArticleAgent Durable Object if available
    if (agentNamespace) {
      try {
        // Get article to find its URL (used as DO ID)
        const article = await db
          .prepare("SELECT url FROM articles WHERE id = ? LIMIT 1")
          .bind(body.article_id)
          .first<{ url: string }>()

        if (article) {
          // Get the Durable Object instance for this article
          const id = agentNamespace.idFromName(article.url)
          const stub = agentNamespace.get(id)

          // Send feedback to the agent
          await stub.fetch("https://fake-host/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        }
      } catch (agentError) {
        // Non-critical error - log but don't fail the request
        console.error("Failed to send feedback to agent:", agentError)
      }
    }

    // Get updated article
    const updatedArticle = await db
      .prepare("SELECT * FROM articles WHERE id = ? LIMIT 1")
      .bind(body.article_id)
      .first()

    return {
      success: true,
      message: "Feedback recorded successfully",
      article: updatedArticle,
      feedback_type: body.feedback_type,
    }
  } catch (error: any) {
    console.error("Feedback error:", error)
    return {
      success: false,
      error: error.message || "Failed to process feedback",
    }
  }
})
