/**
 * GET /api/agent/collections
 *
 * Returns all active collections with article counts
 * Collections help the AI understand user interests
 */

export default defineEventHandler(async (event) => {
  try {
    const db = event.context.cloudflare?.env?.NEWSNOW_DB

    if (!db) {
      return {
        success: false,
        error: "Database not available",
      }
    }

    // Get all collections with article counts
    const result = await db.prepare(`
      SELECT
        c.id,
        c.name,
        c.description,
        c.color,
        c.is_active,
        c.created_at,
        c.updated_at,
        COUNT(ci.article_id) as article_count
      FROM collections c
      LEFT JOIN collection_items ci ON c.id = ci.collection_id
      WHERE c.is_active = 1
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `).all()

    return {
      success: true,
      collections: result.results || [],
    }
  } catch (error: any) {
    console.error("Collections fetch error:", error)
    return {
      success: false,
      error: error.message || "Failed to fetch collections",
    }
  }
})
