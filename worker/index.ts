/**
 * Cloudflare Worker Entry Point
 *
 * Handles:
 * - Queue consumption for article ingestion
 * - Durable Object exports
 * - Worker fetch requests
 */

import { ArticleAgent } from "../server/agent/article-agent"
import type { ArticleQueueMessage, Env } from "../server/types/cloudflare"

/**
 * Export the ArticleAgent Durable Object
 */
export { ArticleAgent }

/**
 * Queue consumer for article ingestion
 * Receives batches of URLs and spawns ArticleAgent Durable Objects to process them
 */
export default {
  async queue(
    batch: MessageBatch<ArticleQueueMessage>,
    env: Env,
  ): Promise<void> {
    console.log(`Processing batch of ${batch.messages.length} articles`)

    for (const message of batch.messages) {
      try {
        const { url, source } = message.body

        console.log(`Processing article from ${source || "unknown"}: ${url}`)

        // Get or create a Durable Object for this article
        // Using URL as the ID ensures we don't process the same URL multiple times
        const id = env.ARTICLE_AGENT.idFromName(url)
        const agent = env.ARTICLE_AGENT.get(id)

        // Trigger article processing
        const response = await agent.fetch("https://fake-host/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        })

        const result = await response.json() as { success: boolean, articleId?: number, error?: string }

        if (result.success) {
          console.log(`✓ Successfully processed article ${result.articleId}: ${url}`)
          message.ack()
        } else {
          console.error(`✗ Failed to process article: ${url}`, result.error)
          // Don't ack - let it retry
          message.retry()
        }
      } catch (error: any) {
        console.error("Queue processing error:", error)
        message.retry()
      }
    }
  },

  /**
   * Handle fetch requests (if needed for direct worker access)
   */
  async fetch(
    request: Request,
    _env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url)

    // Health check endpoint
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({
        status: "healthy",
        timestamp: Date.now(),
        service: "newsnow-article-agent",
      }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    // Forward to Nitro/h3 handler for regular requests
    // This allows the existing app to continue working
    return new Response("Article Agent Worker - Use /health for status", {
      headers: { "Content-Type": "text/plain" },
    })
  },
}
