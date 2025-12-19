/**
 * POST /api/agent/search
 *
 * Semantic search endpoint using RAG (Retrieval-Augmented Generation)
 * Searches the Vectorize knowledge base for relevant articles
 */

import { defineEventHandler, readBody } from "h3"
import { BaseAgent } from "~/src/agents/base"
import type { Env } from "~/server/types/cloudflare"

export default defineEventHandler(async (event) => {
  try {
    const env = event.context.cloudflare.env as Env
    const body = await readBody(event)

    // Validate request body
    if (!body.query || typeof body.query !== "string") {
      return {
        success: false,
        error: "Query is required and must be a string",
      }
    }

    const { query, limit = 10 } = body

    // Create a BaseAgent instance for search
    // Note: We use a temporary SQLite instance since we don't need persistent state
    const agent = new BaseAgent(
      {
        NEWSNOW_DB: env.NEWSNOW_DB,
        AI: env.AI,
        VECTOR_INDEX: env.VECTOR_INDEX,
      },
      {}, // Empty SQL state for one-off operations
    )

    // Perform semantic search
    const results = await agent.searchKnowledgeBase(query, Math.min(limit, 50))

    // Enrich results with full article data from D1
    const enrichedResults = await Promise.all(
      results.map(async (result) => {
        const article = await env.NEWSNOW_DB
          .prepare(`
            SELECT
              a.id,
              a.url,
              a.title,
              a.description,
              a.author,
              a.published_date,
              a.time_roi,
              a.ranking,
              a.status,
              a.created_at,
              a.updated_at,
              GROUP_CONCAT(t.name) as tags
            FROM articles a
            LEFT JOIN article_tag_map atm ON a.id = atm.article_id
            LEFT JOIN article_tags t ON atm.tag_id = t.id
            WHERE a.id = ?
            GROUP BY a.id
          `)
          .bind(result.metadata.articleId)
          .first()

        return {
          ...result,
          article: article || null,
        }
      }),
    )

    return {
      success: true,
      query,
      count: enrichedResults.length,
      results: enrichedResults,
    }
  } catch (error) {
    console.error("Search error:", error)

    return {
      success: false,
      error: error instanceof Error ? error.message : "Search failed",
    }
  }
})
