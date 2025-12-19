/**
 * BaseAgent - Foundation for all agents in the system
 *
 * This class extends the Cloudflare Agents SDK Agent class and provides
 * "batteries included" utilities for:
 * - Global context awareness (D1 reads)
 * - Intelligent tag management
 * - Knowledge persistence (D1 writes)
 * - AI wrapper with error handling
 *
 * All specialized agents (ArticleAgent, OrchestratorAgent, etc.) should
 * extend this class to inherit these utilities.
 */

import { Agent } from "agents"
import type { D1Database } from "@cloudflare/workers-types"
import type { Ai } from "@cloudflare/ai"
import type {
  AIRequestOptions,
  AIResponse,
  ArticleData,
  FeedbackPattern,
  GlobalContext,
  R2Data,
  TagReconciliationResult,
  TagRegistryEntry,
} from "./types"

/**
 * Environment bindings for agents
 */
export interface AgentEnv {
  NEWSNOW_DB: D1Database
  AI: Ai
  [key: string]: any
}

/**
 * BaseAgent - Provides shared tooling for all agents
 */
export class BaseAgent extends Agent<AgentEnv> {
  protected globalContext: GlobalContext | null = null

  /**
   * Load global context from D1
   * This includes user collections, tag registry, and feedback patterns
   *
   * @returns GlobalContext containing all user preference data
   */
  async loadGlobalContext(): Promise<GlobalContext> {
    // Check if already loaded in this agent instance
    if (this.globalContext) {
      return this.globalContext
    }

    const db = this.env.NEWSNOW_DB

    // Load collections
    const collectionsResult = await db
      .prepare(`
        SELECT id, name, description, color, is_active, created_at, updated_at
        FROM collections
        WHERE is_active = 1
        ORDER BY created_at DESC
      `)
      .all()

    const collections = (collectionsResult.results || []) as any[]

    // Load tag registry with usage counts
    const tagsResult = await db
      .prepare(`
        SELECT
          t.id,
          t.name,
          t.description,
          t.is_active,
          COUNT(atm.article_id) as usage_count
        FROM article_tags t
        LEFT JOIN article_tag_map atm ON t.id = atm.tag_id
        WHERE t.is_active = 1
        GROUP BY t.id, t.name, t.description, t.is_active
        ORDER BY usage_count DESC
      `)
      .all()

    const tagRegistry = (tagsResult.results || []) as TagRegistryEntry[]

    // Load feedback patterns (aggregated stats)
    const feedbackStats = await db
      .prepare(`
        SELECT
          COUNT(DISTINCT a.id) as total_articles,
          COUNT(DISTINCT CASE WHEN f.feedback_type = 'upvote' THEN a.id END) as upvoted,
          COUNT(DISTINCT CASE WHEN f.feedback_type = 'downvote' THEN a.id END) as downvoted,
          COUNT(DISTINCT CASE WHEN f.feedback_type = 'saved' THEN a.id END) as saved,
          COUNT(DISTINCT CASE WHEN a.status = 'archived' THEN a.id END) as archived,
          AVG(a.ranking) as avg_ranking
        FROM articles a
        LEFT JOIN article_feedback f ON a.id = f.article_id
      `)
      .first() as any

    // Get top tags from feedback
    const topTagsResult = await db
      .prepare(`
        SELECT t.name as tag, COUNT(*) as count
        FROM article_tag_map atm
        JOIN article_tags t ON atm.tag_id = t.id
        JOIN articles a ON atm.article_id = a.id
        WHERE a.status != 'error'
        GROUP BY t.name
        ORDER BY count DESC
        LIMIT 10
      `)
      .all()

    // Get top collections
    const topCollectionsResult = await db
      .prepare(`
        SELECT c.name as collection, COUNT(*) as count
        FROM collection_items ci
        JOIN collections c ON ci.collection_id = c.id
        GROUP BY c.name
        ORDER BY count DESC
        LIMIT 10
      `)
      .all()

    const feedbackPatterns: FeedbackPattern = {
      totalArticles: feedbackStats?.total_articles || 0,
      upvotedArticles: feedbackStats?.upvoted || 0,
      downvotedArticles: feedbackStats?.downvoted || 0,
      savedArticles: feedbackStats?.saved || 0,
      archivedArticles: feedbackStats?.archived || 0,
      averageRanking: feedbackStats?.avg_ranking || 50,
      topTags: (topTagsResult.results || []) as any[],
      topCollections: (topCollectionsResult.results || []) as any[],
    }

    this.globalContext = {
      collections,
      tagRegistry,
      feedbackPatterns,
    }

    return this.globalContext
  }

  /**
   * Reconcile suggested tags against the global tag registry
   * Uses fuzzy matching (case-insensitive) to prevent duplicates
   *
   * @param suggestedTags Array of tag names suggested by AI
   * @returns Array of TagReconciliationResults with tag IDs
   */
  async reconcileTags(suggestedTags: string[]): Promise<TagReconciliationResult[]> {
    const db = this.env.NEWSNOW_DB
    const results: TagReconciliationResult[] = []

    // Ensure global context is loaded
    if (!this.globalContext) {
      await this.loadGlobalContext()
    }

    for (const suggestedTag of suggestedTags) {
      const normalizedTag = suggestedTag.trim().toLowerCase()

      // Check if tag exists in registry (case-insensitive)
      const existingTag = this.globalContext!.tagRegistry.find(
        tag => tag.name.toLowerCase() === normalizedTag,
      )

      if (existingTag) {
        // Use existing tag
        results.push({
          tagId: existingTag.id,
          tagName: existingTag.name, // Use canonical form
          isNew: false,
        })
      } else {
        // Create new tag
        const now = Date.now()
        const newTag = await db
          .prepare(`
            INSERT INTO article_tags (name, is_active, created_at)
            VALUES (?, 1, ?)
            RETURNING id, name
          `)
          .bind(suggestedTag.trim(), now)
          .first() as { id: number, name: string }

        if (newTag) {
          // Add to local registry for future lookups in this session
          this.globalContext!.tagRegistry.push({
            id: newTag.id,
            name: newTag.name,
            description: null,
            is_active: 1,
            usage_count: 0,
          })

          results.push({
            tagId: newTag.id,
            tagName: newTag.name,
            isNew: true,
          })
        }
      }
    }

    return results
  }

  /**
   * Save article analysis to D1 (transactional write)
   * Updates articles table, tag mappings, and R2 object references
   *
   * @param articleData Article data to save
   * @param r2Keys R2 storage keys for artifacts
   * @returns Success boolean
   */
  async saveArticleAnalysis(
    articleData: ArticleData,
    r2Keys?: R2Data,
  ): Promise<boolean> {
    const db = this.env.NEWSNOW_DB
    const now = Date.now()

    try {
      // Update articles table
      if (articleData.id) {
        // Update existing article
        await db
          .prepare(`
            UPDATE articles
            SET title = COALESCE(?, title),
                description = COALESCE(?, description),
                author = COALESCE(?, author),
                published_date = COALESCE(?, published_date),
                time_roi = COALESCE(?, time_roi),
                ranking = COALESCE(?, ranking),
                status = ?,
                updated_at = ?
            WHERE id = ?
          `)
          .bind(
            articleData.title || null,
            articleData.description || null,
            articleData.author || null,
            articleData.published_date || null,
            articleData.time_roi || null,
            articleData.ranking || null,
            articleData.status,
            now,
            articleData.id,
          )
          .run()

        // Handle tags if provided
        if (articleData.tags && articleData.tags.length > 0) {
          const tagResults = await this.reconcileTags(articleData.tags)

          for (const tagResult of tagResults) {
            await db
              .prepare(`
                INSERT OR IGNORE INTO article_tag_map (article_id, tag_id, created_at)
                VALUES (?, ?, ?)
              `)
              .bind(articleData.id, tagResult.tagId, now)
              .run()
          }
        }

        // Handle R2 object references
        if (r2Keys) {
          if (r2Keys.pdfKey) {
            await db
              .prepare(`
                INSERT INTO article_r2_objects (article_id, r2_key, file_type, file_size, created_at)
                VALUES (?, ?, 'pdf', ?, ?)
              `)
              .bind(articleData.id, r2Keys.pdfKey, r2Keys.pdfSize || 0, now)
              .run()
          }

          if (r2Keys.markdownKey) {
            await db
              .prepare(`
                INSERT INTO article_r2_objects (article_id, r2_key, file_type, file_size, created_at)
                VALUES (?, ?, 'md', ?, ?)
              `)
              .bind(articleData.id, r2Keys.markdownKey, r2Keys.markdownSize || 0, now)
              .run()
          }

          if (r2Keys.jsonKey) {
            await db
              .prepare(`
                INSERT INTO article_r2_objects (article_id, r2_key, file_type, file_size, created_at)
                VALUES (?, ?, 'json', ?, ?)
              `)
              .bind(articleData.id, r2Keys.jsonKey, r2Keys.jsonSize || 0, now)
              .run()
          }
        }

        return true
      } else {
        // Cannot save without article ID
        throw new Error("Article ID is required for saveArticleAnalysis")
      }
    } catch (error) {
      console.error("Error saving article analysis:", error)
      return false
    }
  }

  /**
   * AI wrapper with error handling and JSON parsing
   * Provides a clean interface to Workers AI with automatic retries
   *
   * @param systemPrompt System instructions for the AI
   * @param userContent User content/question for the AI
   * @param jsonSchema Optional JSON schema for validation
   * @param options Request options (model, temperature, retries)
   * @returns AIResponse with parsed data or error
   */
  async askAI<T = any>(
    systemPrompt: string,
    userContent: string,
    jsonSchema?: object,
    options: AIRequestOptions = {},
  ): Promise<AIResponse<T>> {
    const {
      model = "@cf/meta/llama-3-8b-instruct",
      temperature = 0.7,
      maxTokens = 2048,
      retries = 3,
    } = options

    let lastError: Error | null = null

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        // Call Workers AI
        const response = await this.env.AI.run(model, {
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userContent,
            },
          ],
          temperature,
          max_tokens: maxTokens,
        }) as any

        const responseText = response.response || JSON.stringify(response)

        // If JSON schema provided, attempt to parse and validate
        if (jsonSchema) {
          try {
            // Extract JSON from response (handles markdown code blocks)
            const jsonMatch = responseText.match(/\{[\s\S]*\}/)
            if (!jsonMatch) {
              throw new Error("No JSON found in AI response")
            }

            const parsed = JSON.parse(jsonMatch[0]) as T

            // Basic validation - check if parsed object is not empty
            if (!parsed || typeof parsed !== "object") {
              throw new Error("Parsed JSON is invalid")
            }

            return {
              success: true,
              data: parsed,
              rawResponse: responseText,
            }
          } catch (parseError: any) {
            // If parsing fails, retry
            lastError = parseError
            console.warn(`AI JSON parse error (attempt ${attempt + 1}/${retries}):`, parseError.message)

            // Wait before retry (exponential backoff)
            if (attempt < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
            }
            continue
          }
        } else {
          // Return raw response if no schema
          return {
            success: true,
            data: responseText as T,
            rawResponse: responseText,
          }
        }
      } catch (error: any) {
        lastError = error
        console.error(`AI request error (attempt ${attempt + 1}/${retries}):`, error.message)

        // Wait before retry (exponential backoff)
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
        }
      }
    }

    // All retries failed
    return {
      success: false,
      error: lastError?.message || "AI request failed after all retries",
    }
  }

  /**
   * Get article by URL from D1
   * Utility method for agents to fetch existing articles
   */
  protected async getArticleByUrl(url: string): Promise<ArticleData | null> {
    const result = await this.env.NEWSNOW_DB
      .prepare("SELECT * FROM articles WHERE url = ? LIMIT 1")
      .bind(url)
      .first() as ArticleData | null

    return result
  }

  /**
   * Get article by ID from D1
   * Utility method for agents to fetch existing articles
   */
  protected async getArticleById(id: number): Promise<ArticleData | null> {
    const result = await this.env.NEWSNOW_DB
      .prepare("SELECT * FROM articles WHERE id = ? LIMIT 1")
      .bind(id)
      .first() as ArticleData | null

    return result
  }

  /**
   * Log agent activity (can be extended for observability)
   */
  protected log(message: string, data?: any): void {
    const logEntry = {
      agent: this.constructor.name,
      message,
      data,
      timestamp: new Date().toISOString(),
    }

    console.log(JSON.stringify(logEntry))
  }
}
