/**
 * HumanInTheLoopAgent - Handles user feedback and learning
 *
 * This agent manages the "Human-in-the-Loop" workflow:
 * 1. Processes user feedback (upvotes, downvotes, saves, archives)
 * 2. Analyzes feedback patterns to improve future rankings
 * 3. Updates the AI's understanding of user preferences
 * 4. Manages collections as training data
 * 5. Flags inconsistencies for user clarification
 *
 * Uses BaseAgent utilities for:
 * - Global context (to understand current preferences)
 * - Tag reconciliation (when user adds tags)
 * - Knowledge persistence (updating feedback records)
 * - AI calls (to learn from feedback patterns)
 */

import { BaseAgent } from "./base"
import type { ArticleData } from "./types"

/**
 * Feedback types from the user
 */
export type FeedbackType = "upvote" | "downvote" | "saved" | "archived" | "tag_added" | "tag_removed"

/**
 * User feedback data
 */
export interface UserFeedback {
  articleId: number
  feedbackType: FeedbackType
  tags?: string[]
  collectionId?: number
  notes?: string
  manualRanking?: number
}

/**
 * Learning insight from feedback
 */
interface LearningInsight {
  pattern: string
  confidence: number
  recommendation: string
  affectedArticles: number
}

/**
 * HumanInTheLoopAgent - Learning from user feedback
 */
export class HumanInTheLoopAgent extends BaseAgent {
  /**
   * Process user feedback and update system learning
   *
   * @param feedback User feedback data
   * @returns Success boolean
   */
  async processFeedback(feedback: UserFeedback): Promise<boolean> {
    this.log("Processing user feedback", { feedback })

    // Load global context to understand current state
    await this.loadGlobalContext()

    // Get the article being rated
    const article = await this.getArticleById(feedback.articleId)

    if (!article) {
      this.log("Article not found", { articleId: feedback.articleId })
      return false
    }

    // Record feedback in D1
    await this.recordFeedback(feedback)

    // Update article based on feedback type
    await this.applyFeedbackToArticle(feedback, article)

    // Analyze feedback for learning insights
    const insights = await this.extractLearningInsights(feedback, article)

    // Apply insights to improve future rankings
    if (insights.length > 0) {
      await this.applyLearningInsights(insights)
    }

    this.log("Feedback processing complete", { feedback, insights })

    return true
  }

  /**
   * Record feedback in D1 for future analysis
   */
  private async recordFeedback(feedback: UserFeedback): Promise<void> {
    const now = Date.now()

    await this.env.NEWSNOW_DB
      .prepare(`
        INSERT INTO article_feedback (article_id, feedback_type, feedback_data, created_at)
        VALUES (?, ?, ?, ?)
      `)
      .bind(
        feedback.articleId,
        feedback.feedbackType,
        JSON.stringify(feedback),
        now,
      )
      .run()
  }

  /**
   * Apply feedback to the article (ranking, status, tags, collections)
   */
  private async applyFeedbackToArticle(
    feedback: UserFeedback,
    article: ArticleData,
  ): Promise<void> {
    const updates: Partial<ArticleData> = {
      id: feedback.articleId,
      url: article.url,
      status: article.status,
    }

    // Apply ranking changes based on feedback type
    switch (feedback.feedbackType) {
      case "upvote":
        updates.ranking = Math.min(100, (article.ranking || 50) + 10)
        break
      case "downvote":
        updates.ranking = Math.max(1, (article.ranking || 50) - 10)
        break
      case "saved":
        updates.ranking = Math.min(100, (article.ranking || 50) + 5)
        updates.status = "read"
        break
      case "archived":
        updates.status = "archived"
        break
    }

    // Apply manual ranking override if provided
    if (feedback.manualRanking !== undefined) {
      updates.ranking = Math.max(1, Math.min(100, feedback.manualRanking))
    }

    // Handle tags if provided
    if (feedback.tags && feedback.tags.length > 0) {
      updates.tags = feedback.tags
    }

    // Save updates via BaseAgent
    await this.saveArticleAnalysis(updates)

    // Handle collection assignment
    if (feedback.collectionId) {
      const now = Date.now()
      await this.env.NEWSNOW_DB
        .prepare(`
          INSERT OR IGNORE INTO collection_items (collection_id, article_id, notes, created_at)
          VALUES (?, ?, ?, ?)
        `)
        .bind(feedback.collectionId, feedback.articleId, feedback.notes || "", now)
        .run()
    }
  }

  /**
   * Extract learning insights from feedback patterns
   */
  private async extractLearningInsights(
    _feedback: UserFeedback,
    _article: ArticleData,
  ): Promise<LearningInsight[]> {
    const insights: LearningInsight[] = []

    // Get global feedback patterns
    const patterns = this.globalContext?.feedbackPatterns

    if (!patterns) {
      return insights
    }

    // Detect patterns
    // Example: User consistently upvotes articles with certain tags
    // Example: User consistently downgrades articles from certain sources
    // Example: User prefers longer, technical content

    // TODO: Implement sophisticated pattern detection
    // For now, return placeholder

    return insights
  }

  /**
   * Apply learning insights to improve future rankings
   */
  private async applyLearningInsights(insights: LearningInsight[]): Promise<void> {
    this.log("Applying learning insights", { count: insights.length })

    // TODO: Implement learning application
    // - Update ranking algorithms
    // - Adjust AI prompts based on learned preferences
    // - Re-rank similar unread articles
  }

  /**
   * Detect inconsistencies in user feedback
   * Flag for user clarification
   */
  async detectInconsistencies(): Promise<Array<{
    articleId: number
    inconsistency: string
    question: string
  }>> {
    this.log("Detecting feedback inconsistencies")

    const inconsistencies: Array<{
      articleId: number
      inconsistency: string
      question: string
    }> = []

    // TODO: Implement inconsistency detection
    // Examples:
    // - User upvoted an article but archived similar ones
    // - User's manual ranking conflicts with AI recommendation
    // - User added to collection but downvoted the article

    return inconsistencies
  }

  /**
   * Generate recommendations based on user's feedback history
   */
  async generateRecommendations(limit: number = 10): Promise<ArticleData[]> {
    this.log("Generating recommendations", { limit })

    // Load global context to understand preferences
    await this.loadGlobalContext()

    // TODO: Implement recommendation engine
    // - Analyze feedback patterns
    // - Find articles matching user's preferred tags/collections
    // - Rank by predicted user interest
    // - Return top N recommendations

    return []
  }
}
