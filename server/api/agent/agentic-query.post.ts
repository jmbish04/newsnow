/**
 * POST /api/agent/agentic-query
 *
 * Agentic RAG endpoint - Intelligent question-answering over the knowledge base
 * Uses RAGAgent to perform multi-stage reasoning and synthesis
 */

import { defineEventHandler, readBody } from "h3"
import { RAGAgent } from "~/src/agents/rag-agent"
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

    // Validate limit
    if (typeof limit !== "number" || limit < 1 || limit > 50) {
      return {
        success: false,
        error: "Limit must be a number between 1 and 50",
      }
    }

    // Create RAGAgent instance
    const agent = new RAGAgent(
      {
        NEWSNOW_DB: env.NEWSNOW_DB,
        AI: env.AI,
        VECTOR_INDEX: env.VECTOR_INDEX,
      },
      {}, // Empty SQL state for stateless operation
    )

    // Perform agentic RAG query
    const result = await agent.answerQuery(query, limit)

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Query failed",
      }
    }

    // Enrich retrieved articles with full data from D1
    const enrichedArticles = await Promise.all(
      (result.retrieved_articles || []).map(async (vectorResult) => {
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
              a.updated_at
            FROM articles a
            WHERE a.id = ?
          `)
          .bind(vectorResult.metadata.articleId)
          .first()

        // Get tags
        const tagsResult = await env.NEWSNOW_DB
          .prepare(`
            SELECT t.name
            FROM article_tags t
            JOIN article_tag_map atm ON t.id = atm.tag_id
            WHERE atm.article_id = ?
          `)
          .bind(vectorResult.metadata.articleId)
          .all()

        const tags = (tagsResult.results || []).map((t: any) => t.name)

        return {
          ...vectorResult,
          article: article ? { ...article, tags } : null,
        }
      }),
    )

    return {
      success: true,
      query,
      answer: result.data,
      retrieved_articles: enrichedArticles,
      metadata: {
        retrieval_count: enrichedArticles.length,
        cited_count: result.data?.cited_article_ids.length || 0,
        confidence: result.data?.confidence_score || 0,
      },
    }
  } catch (error) {
    console.error("Agentic query error:", error)

    return {
      success: false,
      error: error instanceof Error ? error.message : "Query failed",
    }
  }
})
