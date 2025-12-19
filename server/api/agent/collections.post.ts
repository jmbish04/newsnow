/**
 * POST /api/agent/collections
 *
 * Create a new collection
 * Collections are used by the AI to understand user interests and improve article ranking
 *
 * Example payload:
 * {
 *   "name": "Rust Performance",
 *   "description": "Deep dives into Rust memory management and performance optimization",
 *   "color": "#ff6b6b"
 * }
 */

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)

    if (!body || !body.name) {
      return {
        success: false,
        error: "Missing \"name\" in request body",
      }
    }

    const db = event.context.cloudflare?.env?.NEWSNOW_DB

    if (!db) {
      return {
        success: false,
        error: "Database not available",
      }
    }

    const now = Date.now()

    // Check if collection with this name already exists
    const existing = await db
      .prepare("SELECT id FROM collections WHERE name = ? LIMIT 1")
      .bind(body.name)
      .first()

    if (existing) {
      return {
        success: false,
        error: "A collection with this name already exists",
      }
    }

    // Create collection
    const result = await db
      .prepare(`
        INSERT INTO collections (name, description, color, is_active, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
        RETURNING *
      `)
      .bind(
        body.name,
        body.description || null,
        body.color || null,
        now,
        now,
      )
      .first()

    return {
      success: true,
      message: "Collection created successfully",
      collection: result,
    }
  } catch (error: any) {
    console.error("Collection creation error:", error)
    return {
      success: false,
      error: error.message || "Failed to create collection",
    }
  }
})
