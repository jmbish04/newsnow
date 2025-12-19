/**
 * GET /api/agent/feed
 *
 * Returns unread articles sorted by ranking (highest first)
 *
 * Query parameters:
 * - limit: number of articles to return (default: 50, max: 200)
 * - offset: pagination offset (default: 0)
 * - status: filter by status (default: 'unread')
 * - collection_id: filter by collection ID (optional)
 * - tag: filter by tag name (optional)
 * - min_ranking: minimum ranking score (optional)
 */

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const db = event.context.cloudflare?.env?.NEWSNOW_DB

    if (!db) {
      return {
        success: false,
        error: "Database not available",
      }
    }

    // Parse query parameters
    const limit = Math.min(Number.parseInt(query.limit as string) || 50, 200)
    const offset = Number.parseInt(query.offset as string) || 0
    const status = query.status as string || "unread"
    const collectionId = query.collection_id ? Number.parseInt(query.collection_id as string) : null
    const tag = query.tag as string || null
    const minRanking = query.min_ranking ? Number.parseInt(query.min_ranking as string) : 0

    // Build query
    let sql = `
      SELECT DISTINCT
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
    `

    const bindings: any[] = []
    const conditions: string[] = []

    // Filter by status
    conditions.push("a.status = ?")
    bindings.push(status)

    // Filter by minimum ranking
    if (minRanking > 0) {
      conditions.push("a.ranking >= ?")
      bindings.push(minRanking)
    }

    // Filter by collection
    if (collectionId) {
      sql += " INNER JOIN collection_items ci ON a.id = ci.article_id"
      conditions.push("ci.collection_id = ?")
      bindings.push(collectionId)
    }

    // Filter by tag
    if (tag) {
      sql += `
        INNER JOIN article_tag_map atm ON a.id = atm.article_id
        INNER JOIN article_tags at ON atm.tag_id = at.id
      `
      conditions.push("at.name = ?")
      bindings.push(tag)
    }

    // Add WHERE clause
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`
    }

    // Order by ranking (highest first), then by created_at (newest first)
    sql += " ORDER BY a.ranking DESC, a.created_at DESC"

    // Add pagination
    sql += " LIMIT ? OFFSET ?"
    bindings.push(limit, offset)

    // Execute query
    const result = await db.prepare(sql).bind(...bindings).all()
    const articles = result.results || []

    // Get tags for each article
    const articlesWithTags = await Promise.all(
      articles.map(async (article: any) => {
        const tags = await db
          .prepare(`
            SELECT at.id, at.name, at.description
            FROM article_tags at
            INNER JOIN article_tag_map atm ON at.id = atm.tag_id
            WHERE atm.article_id = ?
          `)
          .bind(article.id)
          .all()

        return {
          ...article,
          tags: tags.results || [],
        }
      }),
    )

    // Get total count for pagination
    let countSql = "SELECT COUNT(DISTINCT a.id) as total FROM articles a"
    const countBindings: any[] = []
    const countConditions: string[] = []

    countConditions.push("a.status = ?")
    countBindings.push(status)

    if (minRanking > 0) {
      countConditions.push("a.ranking >= ?")
      countBindings.push(minRanking)
    }

    if (collectionId) {
      countSql += " INNER JOIN collection_items ci ON a.id = ci.article_id"
      countConditions.push("ci.collection_id = ?")
      countBindings.push(collectionId)
    }

    if (tag) {
      countSql += `
        INNER JOIN article_tag_map atm ON a.id = atm.article_id
        INNER JOIN article_tags at ON atm.tag_id = at.id
      `
      countConditions.push("at.name = ?")
      countBindings.push(tag)
    }

    if (countConditions.length > 0) {
      countSql += ` WHERE ${countConditions.join(" AND ")}`
    }

    const countResult = await db.prepare(countSql).bind(...countBindings).first()
    const total = (countResult as any)?.total || 0

    return {
      success: true,
      articles: articlesWithTags,
      pagination: {
        limit,
        offset,
        total,
        has_more: offset + limit < total,
      },
      filters: {
        status,
        collection_id: collectionId,
        tag,
        min_ranking: minRanking,
      },
    }
  } catch (error: any) {
    console.error("Feed error:", error)
    return {
      success: false,
      error: error.message || "Failed to fetch feed",
    }
  }
})
