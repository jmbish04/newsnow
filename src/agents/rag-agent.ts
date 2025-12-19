/**
 * RAGAgent - Agentic Retrieval-Augmented Generation
 *
 * This agent performs intelligent question-answering over the article knowledge base.
 * It uses a multi-stage "Agentic" workflow:
 * 1. Intent analysis (query optimization)
 * 2. Vector search retrieval
 * 3. Context construction
 * 4. Structured reasoning synthesis
 */

import { BaseAgent } from "./base"
import type { VectorSearchResult } from "./base"

/**
 * RAG Query Result
 */
export interface RAGQueryResult {
  thinking_process: string
  answer_markdown: string
  confidence_score: number
  cited_article_ids: number[]
  follow_up_suggestions: string[]
}

/**
 * RAG Response (includes metadata)
 */
export interface RAGResponse {
  success: boolean
  data?: RAGQueryResult
  retrieved_articles?: VectorSearchResult[]
  error?: string
}

/**
 * RAGAgent - Intelligent question-answering agent
 *
 * Extends BaseAgent to inherit:
 * - searchKnowledgeBase() for vector retrieval
 * - WorkerAI instance for multi-model AI
 * - D1 access for article enrichment
 */
export class RAGAgent extends BaseAgent {
  /**
   * Answer a user's question using Agentic RAG
   *
   * Workflow:
   * 1. Analyze intent and optimize query
   * 2. Search vector database for relevant articles
   * 3. Construct context from retrieved articles
   * 4. Synthesize answer using structured reasoning
   *
   * @param userQuestion - The user's natural language question
   * @param retrievalLimit - Maximum number of articles to retrieve (default: 10)
   * @returns RAGResponse with answer and citations
   */
  async answerQuery(
    userQuestion: string,
    retrievalLimit: number = 10,
  ): Promise<RAGResponse> {
    try {
      this.log("Starting agentic RAG query", { userQuestion, retrievalLimit })

      // Step 1: Intent Analysis - Optimize the query for vector search
      const optimizedQuery = await this.optimizeQuery(userQuestion)

      this.log("Query optimized", {
        original: userQuestion,
        optimized: optimizedQuery,
      })

      // Step 2: Retrieval - Search the knowledge base
      const retrievedArticles = await this.searchKnowledgeBase(
        optimizedQuery,
        retrievalLimit,
      )

      if (retrievedArticles.length === 0) {
        return {
          success: true,
          data: {
            thinking_process: "No relevant articles found in the knowledge base.",
            answer_markdown: "I couldn't find any articles in your feed related to this question. Try adding more articles or asking about a different topic.",
            confidence_score: 0,
            cited_article_ids: [],
            follow_up_suggestions: [
              "What articles do I have in my feed?",
              "Show me recent articles",
              "What topics do my articles cover?",
            ],
          },
          retrieved_articles: [],
        }
      }

      this.log("Retrieved articles", { count: retrievedArticles.length })

      // Step 3: Context Construction - Format articles for AI
      const contextBlock = await this.constructContext(retrievedArticles)

      // Step 4: Structured Reasoning Synthesis
      const systemPrompt = `You are a research assistant analyzing a personal news feed.

Your task is to answer the user's question using ONLY the provided context from their saved articles.

CRITICAL RULES:
1. Only use information from the provided articles
2. If the answer is not in the context, explicitly state that
3. Always cite which articles you used (by their IDs)
4. Be concise but thorough
5. Format your answer in clear Markdown
6. If you're uncertain, lower the confidence score

Remember: The user trusts you to be honest about what you do and don't know based on their articles.`

      const userContent = `Question: ${userQuestion}

Context from the user's saved articles:

${contextBlock}

Please analyze the context and answer the question.`

      // Define the JSON schema for the response
      const jsonSchema = {
        title: "RAGAnswer",
        type: "object",
        properties: {
          thinking_process: {
            type: "string",
            description: "Brief explanation of how you synthesized the answer from the articles",
          },
          answer_markdown: {
            type: "string",
            description: "The final answer in Markdown format, using only information from the provided articles",
          },
          confidence_score: {
            type: "integer",
            description: "Confidence in the answer from 0-100 (0=no info, 100=very confident)",
            minimum: 0,
            maximum: 100,
          },
          cited_article_ids: {
            type: "array",
            description: "Array of article IDs that were used to construct the answer",
            items: {
              type: "integer",
            },
          },
          follow_up_suggestions: {
            type: "array",
            description: "3 follow-up questions the user might ask next based on the articles",
            items: {
              type: "string",
            },
            minItems: 3,
            maxItems: 3,
          },
        },
        required: [
          "thinking_process",
          "answer_markdown",
          "confidence_score",
          "cited_article_ids",
          "follow_up_suggestions",
        ],
      }

      // Call the smart pipeline (Reasoning → Structured)
      const aiResult = await this.workerAI.generateStructuredReasoning<RAGQueryResult>(
        systemPrompt,
        userContent,
        jsonSchema,
      )

      if (!aiResult.success || !aiResult.data) {
        throw new Error(aiResult.error || "AI reasoning failed")
      }

      this.log("RAG query completed", {
        confidence: aiResult.data.confidence_score,
        citedCount: aiResult.data.cited_article_ids.length,
      })

      return {
        success: true,
        data: aiResult.data,
        retrieved_articles: retrievedArticles,
      }
    } catch (error) {
      this.log("RAG query failed", { error })

      return {
        success: false,
        error: error instanceof Error ? error.message : "RAG query failed",
      }
    }
  }

  /**
   * Optimize the user's query for vector search
   *
   * Removes fluff words and focuses on the core semantic content.
   * Uses the reasoning model for intent analysis.
   *
   * @param userQuestion - The original user question
   * @returns Optimized query string
   */
  private async optimizeQuery(userQuestion: string): Promise<string> {
    try {
      const systemPrompt = `You are a query optimizer for semantic search.

Your task: Convert the user's natural language question into an optimized search query.

Rules:
1. Remove filler words (like, um, please, etc.)
2. Extract the core semantic concepts
3. Keep important context words
4. Make it concise (1-2 sentences max)
5. Preserve technical terms and proper nouns

Example:
Input: "Hey, could you please tell me if there are any articles about AI safety?"
Output: "AI safety artificial intelligence safety concerns risks"

Return ONLY the optimized query, nothing else.`

      const result = await this.workerAI.generateReasoning(
        systemPrompt,
        userQuestion,
      )

      if (result.success && result.data) {
        // Clean up the response (remove quotes, extra whitespace)
        return result.data.trim().replace(/^["']|["']$/g, "")
      }

      // Fallback: use original query
      return userQuestion
    } catch {
      // If optimization fails, use original query
      return userQuestion
    }
  }

  /**
   * Construct context block from retrieved articles
   *
   * Formats article metadata into a structured context for the AI.
   * Enriches with full article data from D1.
   *
   * @param retrievedArticles - Vector search results
   * @returns Formatted context string
   */
  private async constructContext(
    retrievedArticles: VectorSearchResult[],
  ): Promise<string> {
    const contextParts: string[] = []

    for (let i = 0; i < retrievedArticles.length; i++) {
      const result = retrievedArticles[i]
      const articleId = result.metadata.articleId

      // Get full article data from D1
      const article = await this.getArticleById(articleId)

      if (!article) {
        continue
      }

      // Get article tags
      const tagsResult = await this.env.NEWSNOW_DB
        .prepare(`
          SELECT t.name
          FROM article_tags t
          JOIN article_tag_map atm ON t.id = atm.tag_id
          WHERE atm.article_id = ?
        `)
        .bind(articleId)
        .all()

      const tags = (tagsResult.results || []).map((t: any) => t.name).join(", ")

      // Format article context
      const contextEntry = `
Article [ID: ${articleId}] (Relevance: ${(result.score * 100).toFixed(1)}%)
Title: ${article.title || "Untitled"}
Author: ${article.author || "Unknown"}
Published: ${article.published_date || "Unknown"}
URL: ${article.url}
Tags: ${tags || "None"}
Summary: ${article.description || "No description available"}
Time ROI: ${article.time_roi || "Not assessed"}
Quality Ranking: ${article.ranking || "Not ranked"}/100
---
`.trim()

      contextParts.push(contextEntry)
    }

    return contextParts.join("\n\n")
  }
}
