/**
 * EvaluatorOptimizerAgent - The "Secret Second Opinion"
 *
 * This agent provides quality control by re-evaluating articles after
 * the initial analysis. It uses stricter criteria to catch "slop" that
 * might have slipped through the first pass.
 *
 * Key responsibilities:
 * 1. Re-analyze already-processed articles
 * 2. Apply stricter "Time ROI" criteria
 * 3. Downgrade rankings for low-quality content
 * 4. Update D1 with corrected analysis
 * 5. Flag articles for human review if confidence is low
 *
 * Uses BaseAgent utilities for:
 * - Global context (to understand what user actually values)
 * - AI calls (with stricter prompts)
 * - Knowledge persistence (updating corrected rankings)
 */

import { BaseAgent } from "./base"
import type { ArticleData, FeedbackPattern } from "./types"

/**
 * Evaluation criteria
 */
interface EvaluationCriteria {
  minimumDepth: number
  maximumGenericScore: number
  requiresOriginalInsight: boolean
  checkForClickbait: boolean
}

/**
 * Re-evaluation result
 */
interface ReEvaluationResult {
  originalRanking: number
  newRanking: number
  originalTimeROI: string
  newTimeROI: string
  confidence: number
  shouldDowngrade: boolean
  reasoning: string
  flagForHumanReview: boolean
}

/**
 * EvaluatorOptimizerAgent - Quality control through re-evaluation
 */
export class EvaluatorOptimizerAgent extends BaseAgent {
  /**
   * Re-evaluate an article with stricter criteria
   * This is the "second opinion" that catches slop
   *
   * @param articleId Article to re-evaluate
   * @returns ReEvaluationResult with updated analysis
   */
  async reEvaluateArticle(articleId: number): Promise<ReEvaluationResult> {
    this.log("Starting re-evaluation", { articleId })

    // Load global context to understand user preferences
    const context = await this.loadGlobalContext()

    // Get the article and its current analysis
    const article = await this.getArticleById(articleId)

    if (!article) {
      throw new Error(`Article ${articleId} not found`)
    }

    // Get feedback patterns to inform stricter criteria
    const feedbackPatterns = context.feedbackPatterns

    // Build stricter evaluation criteria based on user's actual behavior
    const criteria = this.buildStricterCriteria(feedbackPatterns)

    // Re-analyze with AI using stricter prompt
    const reAnalysis = await this.performStricterAnalysis(article, criteria)

    // Compare and decide if downgrade is needed
    const result: ReEvaluationResult = {
      originalRanking: article.ranking || 50,
      newRanking: reAnalysis.ranking,
      originalTimeROI: article.time_roi || "Unknown",
      newTimeROI: reAnalysis.time_roi,
      confidence: reAnalysis.confidence,
      shouldDowngrade: reAnalysis.ranking < (article.ranking || 50),
      reasoning: reAnalysis.reasoning,
      flagForHumanReview: reAnalysis.confidence < 0.7,
    }

    // If downgrade is warranted, update D1
    if (result.shouldDowngrade) {
      await this.applyDowngrade(articleId, result)
    }

    this.log("Re-evaluation complete", { articleId, result })

    return result
  }

  /**
   * Build stricter criteria based on user's feedback patterns
   */
  private buildStricterCriteria(
    feedbackPatterns: FeedbackPattern,
  ): EvaluationCriteria {
    // Calculate user's actual preferences from feedback
    const upvoteRate = feedbackPatterns.totalArticles > 0
      ? feedbackPatterns.upvotedArticles / feedbackPatterns.totalArticles
      : 0.3

    return {
      minimumDepth: upvoteRate > 0.5 ? 80 : 60,
      maximumGenericScore: 40,
      requiresOriginalInsight: upvoteRate > 0.4,
      checkForClickbait: true,
    }
  }

  /**
   * Perform stricter AI analysis
   */
  private async performStricterAnalysis(
    article: ArticleData,
    criteria: EvaluationCriteria,
  ): Promise<{
      ranking: number
      time_roi: string
      confidence: number
      reasoning: string
    }> {
    // Build a stricter system prompt
    const systemPrompt = `You are a harsh content quality evaluator. Your job is to catch "slop" - low-quality, generic, or clickbait content that wastes the user's time.

Evaluation criteria:
- Minimum depth score: ${criteria.minimumDepth}
- Maximum generic content score: ${criteria.maximumGenericScore}
- Requires original insight: ${criteria.requiresOriginalInsight ? "YES" : "NO"}
- Check for clickbait: ${criteria.checkForClickbait ? "YES" : "NO"}

Be STRICT. It's better to downgrade borderline content than to let slop through.`

    const userContent = `Re-evaluate this article:

Title: ${article.title || "Unknown"}
Description: ${article.description || "Unknown"}
Current Ranking: ${article.ranking || "Unknown"}
Current Time ROI: ${article.time_roi || "Unknown"}

Provide your strict re-evaluation as JSON:
{
  "ranking": <1-100, be harsh>,
  "time_roi": "High/Medium/Low ROI: ...",
  "confidence": <0.0-1.0>,
  "reasoning": "Why this ranking (be specific about quality issues)"
}`

    const _response = await this.askAI(systemPrompt, userContent, {})

    // TODO: Parse and return analysis
    // For now, return placeholder
    return {
      ranking: article.ranking || 50,
      time_roi: article.time_roi || "Unknown",
      confidence: 0.8,
      reasoning: "Not yet implemented - scaffold only",
    }
  }

  /**
   * Apply downgrade to article in D1
   */
  private async applyDowngrade(
    articleId: number,
    result: ReEvaluationResult,
  ): Promise<void> {
    this.log("Applying downgrade", { articleId, result })

    // Use BaseAgent's saveArticleAnalysis to update
    await this.saveArticleAnalysis({
      id: articleId,
      url: "", // Not needed for update
      ranking: result.newRanking,
      time_roi: result.newTimeROI,
      status: result.flagForHumanReview ? "unread" : "unread", // Keep unread but flagged
    })

    // TODO: If flagged for human review, add to review queue
  }

  /**
   * Batch re-evaluation of recent articles
   * Run this periodically to ensure quality
   */
  async batchReEvaluate(limit: number = 10): Promise<void> {
    this.log("Starting batch re-evaluation", { limit })

    // Get recent unread articles
    const articles = await this.env.NEWSNOW_DB
      .prepare(`
        SELECT id
        FROM articles
        WHERE status = 'unread'
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .bind(limit)
      .all()

    for (const article of (articles.results || []) as any[]) {
      try {
        await this.reEvaluateArticle(article.id)
      } catch (error) {
        this.log("Batch re-evaluation error", { articleId: article.id, error })
      }
    }

    this.log("Batch re-evaluation complete")
  }
}
