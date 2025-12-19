/**
 * GET /api/agent/article/:id/artifact/:type
 *
 * Download article artifacts from R2
 * Type can be: pdf, md, json
 */

export default defineEventHandler(async (event) => {
  try {
    const articleId = getRouterParam(event, "id")
    const artifactType = getRouterParam(event, "type")

    if (!articleId || !artifactType) {
      return new Response("Missing article ID or artifact type", { status: 400 })
    }

    const validTypes = ["pdf", "md", "json"]
    if (!validTypes.includes(artifactType)) {
      return new Response("Invalid artifact type. Must be pdf, md, or json", { status: 400 })
    }

    const db = event.context.cloudflare?.env?.NEWSNOW_DB
    const r2 = event.context.cloudflare?.env?.ARTICLE_STORAGE

    if (!db || !r2) {
      return new Response("Database or R2 storage not available", { status: 500 })
    }

    // Get R2 key for this artifact
    const result = await db
      .prepare("SELECT r2_key, file_type FROM article_r2_objects WHERE article_id = ? AND file_type = ? LIMIT 1")
      .bind(Number.parseInt(articleId), artifactType)
      .first<{ r2_key: string, file_type: string }>()

    if (!result) {
      return new Response("Artifact not found", { status: 404 })
    }

    // Fetch from R2
    const object = await r2.get(result.r2_key)

    if (!object) {
      return new Response("Artifact not found in storage", { status: 404 })
    }

    // Determine content type
    const contentTypes: Record<string, string> = {
      pdf: "application/pdf",
      md: "text/markdown",
      json: "application/json",
    }

    // Get article info for filename
    const article = await db
      .prepare("SELECT title, url FROM articles WHERE id = ? LIMIT 1")
      .bind(Number.parseInt(articleId))
      .first<{ title?: string, url: string }>()

    const filename = article?.title
      ? `${article.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.${artifactType}`
      : `article_${articleId}.${artifactType}`

    // Return the file
    return new Response(object.body, {
      headers: {
        "Content-Type": contentTypes[artifactType] || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "public, max-age=3600",
      },
    })
  } catch (error: any) {
    console.error("Artifact fetch error:", error)
    return new Response(error.message || "Failed to fetch artifact", { status: 500 })
  }
})
