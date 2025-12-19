/**
 * ArticleAgent - Durable Object for processing individual articles
 *
 * This agent handles:
 * 1. Browser rendering via REST API (PDF + Markdown generation)
 * 2. AI-powered content extraction and analysis
 * 3. R2 storage of artifacts
 * 4. Ranking and "Time ROI" analysis
 * 5. Human-in-the-loop feedback integration
 */

import type { DurableObject } from "@cloudflare/workers-types"
import type {
  AIAnalysisResult,
  Article,
  BrowserRenderResult,
  Env,
  FeedbackData,
} from "../types/cloudflare"

interface ArticleAgentState {
  articleId?: number
  url: string
  status: "idle" | "processing" | "completed" | "error"
  error?: string
  progress?: string
}

export class ArticleAgent implements DurableObject {
  private state: DurableObjectState
  private env: Env
  private agentState: ArticleAgentState

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    this.agentState = {
      url: "",
      status: "idle",
    }
  }

  /**
   * Main processing method - orchestrates the entire article workflow
   */
  async process(url: string): Promise<{ success: boolean, articleId?: number, error?: string }> {
    try {
      this.agentState = { url, status: "processing", progress: "Starting article processing" }

      // Step 1: Check if article already exists
      const existingArticle = await this.checkExistingArticle(url)
      if (existingArticle) {
        return { success: true, articleId: existingArticle.id }
      }

      // Step 2: Create article record
      this.agentState.progress = "Creating article record"
      const article = await this.createArticleRecord(url)
      this.agentState.articleId = article.id

      // Step 3: Browser rendering (PDF + Markdown) via REST API
      this.agentState.progress = "Rendering page with Browser Rendering API"
      const renderResult = await this.renderWithBrowserAPI(url)

      // Step 4: AI extraction and analysis (including metadata extraction from markdown)
      this.agentState.progress = "Analyzing content with AI"
      const aiAnalysis = await this.analyzeWithAI(renderResult.markdown)

      // Step 5: Store artifacts in R2
      this.agentState.progress = "Storing artifacts in R2"
      await this.storeArtifacts(article.id!, url, renderResult, aiAnalysis)

      // Step 6: Update article with AI insights
      this.agentState.progress = "Updating article with AI insights"
      await this.updateArticleWithAI(article.id!, aiAnalysis)

      // Step 7: Create tags
      this.agentState.progress = "Creating tags"
      await this.createAndAssignTags(article.id!, aiAnalysis.suggested_tags)

      this.agentState.status = "completed"
      return { success: true, articleId: article.id }
    } catch (error: any) {
      this.agentState.status = "error"
      this.agentState.error = error.message

      // Update article status to error if we have an ID
      if (this.agentState.articleId) {
        await this.env.NEWSNOW_DB
          .prepare("UPDATE articles SET status = ?, updated_at = ? WHERE id = ?")
          .bind("error", Date.now(), this.agentState.articleId)
          .run()
      }

      return { success: false, error: error.message }
    }
  }

  /**
   * Check if article already exists in database
   */
  private async checkExistingArticle(url: string): Promise<Article | null> {
    const result = await this.env.NEWSNOW_DB
      .prepare("SELECT * FROM articles WHERE url = ? LIMIT 1")
      .bind(url)
      .first<Article>()

    return result || null
  }

  /**
   * Create initial article record
   */
  private async createArticleRecord(url: string): Promise<Article> {
    const now = Date.now()
    const result = await this.env.NEWSNOW_DB
      .prepare(
        "INSERT INTO articles (url, status, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING *",
      )
      .bind(url, "processing", now, now)
      .first<Article>()

    if (!result) {
      throw new Error("Failed to create article record")
    }

    return result
  }

  /**
   * Render page using Cloudflare Browser Rendering REST API
   * Generates PDF and Markdown via HTTP requests
   */
  private async renderWithBrowserAPI(url: string): Promise<BrowserRenderResult> {
    const accountId = this.env.CF_ACCOUNT_ID
    const apiToken = this.env.CF_API_TOKEN

    if (!accountId || !apiToken) {
      throw new Error("CF_ACCOUNT_ID and CF_API_TOKEN must be configured")
    }

    const headers = {
      "Authorization": `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    }

    // Fetch Markdown
    const markdownResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser/markdown`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          url,
          wait_for: "networkidle",
          timeout: 30000,
        }),
      },
    )

    if (!markdownResponse.ok) {
      const errorText = await markdownResponse.text()
      throw new Error(`Browser Rendering API (markdown) failed: ${markdownResponse.status} - ${errorText}`)
    }

    const markdownData = await markdownResponse.json() as { result: { markdown: string } }
    const markdown = markdownData.result?.markdown || ""

    if (!markdown) {
      throw new Error("No markdown content received from Browser Rendering API")
    }

    // Fetch PDF
    const pdfResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser/pdf`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          url,
          options: {
            format: "A4",
            printBackground: true,
            margin: {
              top: "1cm",
              right: "1cm",
              bottom: "1cm",
              left: "1cm",
            },
          },
          wait_for: "networkidle",
          timeout: 30000,
        }),
      },
    )

    if (!pdfResponse.ok) {
      const errorText = await pdfResponse.text()
      throw new Error(`Browser Rendering API (pdf) failed: ${pdfResponse.status} - ${errorText}`)
    }

    // The PDF endpoint returns binary data
    const pdfBuffer = await pdfResponse.arrayBuffer()

    if (!pdfBuffer || pdfBuffer.byteLength === 0) {
      throw new Error("No PDF content received from Browser Rendering API")
    }

    return {
      pdf_buffer: pdfBuffer,
      markdown,
    }
  }

  /**
   * Analyze content using Workers AI
   * Generates summary, topics, time ROI, ranking, AND extracts metadata
   */
  private async analyzeWithAI(content: string): Promise<AIAnalysisResult> {
    // Get all collections for context
    const collections = await this.env.NEWSNOW_DB
      .prepare("SELECT name, description FROM collections WHERE is_active = 1")
      .all()

    const collectionsContext = collections.results?.map((c: any) =>
      `- ${c.name}: ${c.description || "No description"}`,
    ).join("\n") || "No collections yet"

    // Truncate content if too long (Workers AI has token limits)
    const AI_CONTENT_TRUNCATION_LIMIT = 8000;
    const truncatedContent = content.slice(0, AI_CONTENT_TRUNCATION_LIMIT)

    const prompt = `You are an expert content analyzer helping a user filter and prioritize articles based on their interests.

USER'S COLLECTIONS (their areas of interest):
${collectionsContext}

ARTICLE CONTENT (Markdown):
${truncatedContent}

Analyze this article and provide:
1. Extract metadata: title, author (if present), published_date (if present)
2. A concise summary (2-3 sentences)
3. Main topics/themes (3-5 keywords)
4. "Time ROI" assessment: Is this content valuable deep work or low-value slop? Consider: originality, depth, actionability, and relevance to user's collections.
5. A numerical ranking (1-100) based on how valuable this is for the user
6. Suggested tags (3-7 specific tags)

Respond in JSON format:
{
  "title": "Article Title",
  "author": "Author Name" or null,
  "published_date": "2025-01-15" or null,
  "description": "Brief description...",
  "summary": "...",
  "main_topics": ["topic1", "topic2", ...],
  "time_roi": "High ROI: Deep technical insights on..." or "Low ROI: Generic content with...",
  "ranking": 85,
  "reasoning": "This ranks highly because...",
  "suggested_tags": ["tag1", "tag2", ...]
}`

    const response = await this.env.AI.run("@cf/meta/llama-3-8b-instruct", {
      messages: [
        { role: "user", content: prompt },
      ],
    }) as any

    // Parse AI response
    try {
      const responseText = response.response || JSON.stringify(response)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error("No JSON found in AI response")
      }

      const parsed = JSON.parse(jsonMatch[0])

      return {
        title: parsed.title || null,
        author: parsed.author || null,
        published_date: parsed.published_date || null,
        summary: parsed.summary || parsed.description || "No summary available",
        main_topics: parsed.main_topics || [],
        time_roi: parsed.time_roi || "Unknown",
        ranking: Math.max(1, Math.min(100, parsed.ranking || 50)),
        reasoning: parsed.reasoning || "",
        suggested_tags: parsed.suggested_tags || [],
      }
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError)

      // Fallback analysis
      return {
        title: null,
        author: null,
        published_date: null,
        summary: "Content analysis unavailable",
        main_topics: [],
        time_roi: "Unknown: AI analysis failed",
        ranking: 50,
        reasoning: "Failed to analyze content",
        suggested_tags: [],
      }
    }
  }

  /**
   * Store PDF, Markdown, and JSON in R2
   */
  private async storeArtifacts(
    articleId: number,
    url: string,
    renderResult: BrowserRenderResult,
    aiAnalysis: AIAnalysisResult,
  ): Promise<void> {
    const timestamp = Date.now()
    const urlHash = await this.hashURL(url)

    // Store PDF
    const pdfKey = `articles/${articleId}/${urlHash}.pdf`
    await this.env.ARTICLE_STORAGE.put(pdfKey, renderResult.pdf_buffer, {
      httpMetadata: { contentType: "application/pdf" },
    })

    await this.env.NEWSNOW_DB
      .prepare("INSERT INTO article_r2_objects (article_id, r2_key, file_type, file_size, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(articleId, pdfKey, "pdf", renderResult.pdf_buffer.byteLength, timestamp)
      .run()

    // Store Markdown
    const mdKey = `articles/${articleId}/${urlHash}.md`
    await this.env.ARTICLE_STORAGE.put(mdKey, renderResult.markdown, {
      httpMetadata: { contentType: "text/markdown" },
    })

    await this.env.NEWSNOW_DB
      .prepare("INSERT INTO article_r2_objects (article_id, r2_key, file_type, file_size, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(articleId, mdKey, "md", renderResult.markdown.length, timestamp)
      .run()

    // Store JSON metadata + AI analysis
    const jsonData = {
      url,
      ai_analysis: aiAnalysis,
      processed_at: timestamp,
    }

    const jsonKey = `articles/${articleId}/${urlHash}.json`
    await this.env.ARTICLE_STORAGE.put(jsonKey, JSON.stringify(jsonData, null, 2), {
      httpMetadata: { contentType: "application/json" },
    })

    await this.env.NEWSNOW_DB
      .prepare("INSERT INTO article_r2_objects (article_id, r2_key, file_type, file_size, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(articleId, jsonKey, "json", JSON.stringify(jsonData).length, timestamp)
      .run()
  }

  /**
   * Update article with AI analysis results
   */
  private async updateArticleWithAI(
    articleId: number,
    aiAnalysis: AIAnalysisResult,
  ): Promise<void> {
    await this.env.NEWSNOW_DB
      .prepare(`
        UPDATE articles
        SET title = COALESCE(?, title),
            description = COALESCE(?, description),
            author = COALESCE(?, author),
            published_date = COALESCE(?, published_date),
            time_roi = ?,
            ranking = ?,
            status = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .bind(
        aiAnalysis.title || null,
        aiAnalysis.summary,
        aiAnalysis.author || null,
        aiAnalysis.published_date || null,
        aiAnalysis.time_roi,
        aiAnalysis.ranking,
        "unread",
        Date.now(),
        articleId,
      )
      .run()
  }

  /**
   * Create tags and assign them to the article
   */
  private async createAndAssignTags(articleId: number, tags: string[]): Promise<void> {
    const now = Date.now()

    for (const tagName of tags) {
      // Get or create tag
      let tag = await this.env.NEWSNOW_DB
        .prepare("SELECT id FROM article_tags WHERE name = ? LIMIT 1")
        .bind(tagName)
        .first<{ id: number }>()

      if (!tag) {
        const newTag = await this.env.NEWSNOW_DB
          .prepare("INSERT INTO article_tags (name, is_active, created_at) VALUES (?, 1, ?) RETURNING id")
          .bind(tagName, now)
          .first<{ id: number }>()

        tag = newTag
      }

      if (tag) {
        // Assign tag to article
        await this.env.NEWSNOW_DB
          .prepare("INSERT OR IGNORE INTO article_tag_map (article_id, tag_id, created_at) VALUES (?, ?, ?)")
          .bind(articleId, tag.id, now)
          .run()
      }
    }
  }

  /**
   * Receive feedback from user and update ranking/training data
   */
  async receiveFeedback(feedbackData: FeedbackData): Promise<void> {
    const now = Date.now()

    // Record feedback
    await this.env.NEWSNOW_DB
      .prepare("INSERT INTO article_feedback (article_id, feedback_type, feedback_data, created_at) VALUES (?, ?, ?, ?)")
      .bind(
        feedbackData.article_id,
        feedbackData.feedback_type,
        JSON.stringify(feedbackData),
        now,
      )
      .run()

    // Update ranking based on feedback
    if (feedbackData.score) {
      await this.env.NEWSNOW_DB
        .prepare("UPDATE articles SET ranking = ?, updated_at = ? WHERE id = ?")
        .bind(feedbackData.score, now, feedbackData.article_id)
        .run()
    }

    // Add to collection if specified
    if (feedbackData.collection_id) {
      await this.env.NEWSNOW_DB
        .prepare("INSERT OR IGNORE INTO collection_items (collection_id, article_id, notes, created_at) VALUES (?, ?, ?, ?)")
        .bind(feedbackData.collection_id, feedbackData.article_id, feedbackData.notes || "", now)
        .run()
    }

    // Handle tag changes
    if (feedbackData.tags) {
      await this.createAndAssignTags(feedbackData.article_id, feedbackData.tags)
    }
  }

  /**
   * Get current agent state
   */
  async getState(): Promise<ArticleAgentState> {
    return this.agentState
  }

  /**
   * Hash URL for consistent file naming
   */
  private async hashURL(url: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(url)
    const hashBuffer = await crypto.subtle.digest("SHA-256", data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16)
  }

  /**
   * Handle fetch requests to this Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === "POST" && url.pathname === "/process") {
      const body = await request.json() as { url: string }
      const result = await this.process(body.url)
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      })
    }

    if (request.method === "POST" && url.pathname === "/feedback") {
      const feedbackData = await request.json() as FeedbackData
      await this.receiveFeedback(feedbackData)
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    if (request.method === "GET" && url.pathname === "/state") {
      return new Response(JSON.stringify(this.agentState), {
        headers: { "Content-Type": "application/json" },
      })
    }

    return new Response("Not found", { status: 404 })
  }
}
