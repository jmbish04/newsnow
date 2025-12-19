/**
 * ArticleAgent - Durable Object for processing individual articles
 *
 * This agent handles:
 * 1. Browser rendering (PDF + Markdown generation)
 * 2. AI-powered content extraction and analysis
 * 3. R2 storage of artifacts
 * 4. Ranking and "Time ROI" analysis
 * 5. Human-in-the-loop feedback integration
 */

import type { DurableObject } from "@cloudflare/workers-types"
import puppeteer from "@cloudflare/puppeteer"
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

      // Step 3: Browser rendering (PDF + Markdown)
      this.agentState.progress = "Rendering page with browser"
      const renderResult = await this.renderWithBrowser(url)

      // Step 4: AI extraction and analysis
      this.agentState.progress = "Analyzing content with AI"
      const aiAnalysis = await this.analyzeWithAI(renderResult.markdown)

      // Step 5: Store artifacts in R2
      this.agentState.progress = "Storing artifacts in R2"
      await this.storeArtifacts(article.id!, url, renderResult, aiAnalysis)

      // Step 6: Update article with AI insights
      this.agentState.progress = "Updating article with AI insights"
      await this.updateArticleWithAI(article.id!, aiAnalysis, renderResult.metadata)

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
   * Render page using Cloudflare Browser Rendering
   * Generates PDF and Markdown
   */
  private async renderWithBrowser(url: string): Promise<BrowserRenderResult> {
    const browser = await puppeteer.launch(this.env.BROWSER)

    try {
      const page = await browser.newPage()
      await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 })

      // Extract metadata
      const metadata = await page.evaluate(() => {
        const getMetaContent = (name: string) => {
          const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)
          return meta?.getAttribute("content") || ""
        }

        return {
          title: document.title || getMetaContent("og:title"),
          author: getMetaContent("author") || getMetaContent("article:author"),
          published_date: getMetaContent("article:published_time") || getMetaContent("date"),
          description: getMetaContent("description") || getMetaContent("og:description"),
        }
      })

      // Generate PDF
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "1cm", right: "1cm", bottom: "1cm", left: "1cm" },
      })

      // Generate Markdown (simplified - extract main content)
      const markdown = await page.evaluate(() => {
        // Remove scripts, styles, nav, footer, etc.
        const unwanted = document.querySelectorAll("script, style, nav, footer, header, aside, .ad, .advertisement")
        unwanted.forEach(el => el.remove())

        // Get main content
        const main = document.querySelector("main, article, .content, .post, #content") || document.body

        return `# ${document.title}\n\n${main.textContent || ""}`
      })

      await page.close()

      return {
        pdf_buffer: pdfBuffer,
        markdown,
        metadata,
      }
    } finally {
      await browser.close()
    }
  }

  /**
   * Analyze content using Workers AI
   * Generates summary, topics, time ROI, and ranking
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
    const truncatedContent = content.slice(0, 8000)

    const prompt = `You are an expert content analyzer helping a user filter and prioritize articles based on their interests.

USER'S COLLECTIONS (their areas of interest):
${collectionsContext}

ARTICLE CONTENT:
${truncatedContent}

Analyze this article and provide:
1. A concise summary (2-3 sentences)
2. Main topics/themes (3-5 keywords)
3. "Time ROI" assessment: Is this content valuable deep work or low-value slop? Consider: originality, depth, actionability, and relevance to user's collections.
4. A numerical ranking (1-100) based on how valuable this is for the user
5. Suggested tags (3-7 specific tags)

Respond in JSON format:
{
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
        summary: parsed.summary || "No summary available",
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
      metadata: renderResult.metadata,
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
    metadata: BrowserRenderResult["metadata"],
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
        metadata.title || null,
        metadata.description || aiAnalysis.summary,
        metadata.author || null,
        metadata.published_date || null,
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
