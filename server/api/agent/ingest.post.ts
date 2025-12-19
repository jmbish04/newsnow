/**
 * POST /api/agent/ingest
 *
 * Accepts a raw text string containing URLs (space-separated)
 * Designed to handle Chrome iOS copying multiple URLs as a single string
 *
 * Example payload:
 * {
 *   "text": "https://example.com/article1 https://example.com/article2 https://example.com/article3"
 * }
 */

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)

    if (!body || !body.text) {
      return {
        success: false,
        error: "Missing \"text\" field in request body",
      }
    }

    // Extract URLs from the text
    // Matches http:// or https:// URLs
    const urlRegex = /https?:\/\/\S+/g
    const urls = body.text.match(urlRegex) || []

    if (urls.length === 0) {
      return {
        success: false,
        error: "No valid URLs found in text",
      }
    }

    // Get the queue binding from the event context
    const queue = event.context.cloudflare?.env?.ARTICLE_QUEUE

    if (!queue) {
      return {
        success: false,
        error: "Article queue not available",
      }
    }

    // Send each URL to the queue
    const queuedUrls = []
    for (const url of urls) {
      try {
        await queue.send({
          url: url.trim(),
          source: "manual_ingest",
          priority: 5,
        })
        queuedUrls.push(url.trim())
      } catch (queueError) {
        console.error("Failed to queue URL:", url, queueError)
      }
    }

    return {
      success: true,
      message: `Queued ${queuedUrls.length} article(s) for processing`,
      urls: queuedUrls,
      total_found: urls.length,
      total_queued: queuedUrls.length,
    }
  } catch (error: any) {
    console.error("Ingest error:", error)
    return {
      success: false,
      error: error.message || "Failed to process ingestion request",
    }
  }
})
