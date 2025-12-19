/**
 * Type definitions for the Agent system
 */

/**
 * Global context loaded from D1
 * Contains user preferences, collections, and feedback patterns
 */
export interface GlobalContext {
  collections: Collection[]
  tagRegistry: TagRegistryEntry[]
  feedbackPatterns: FeedbackPattern
}

/**
 * Collection from D1
 */
export interface Collection {
  id: number
  name: string
  description: string | null
  color: string | null
  is_active: number
  created_at: number
  updated_at: number
}

/**
 * Tag registry entry
 */
export interface TagRegistryEntry {
  id: number
  name: string
  description: string | null
  is_active: number
  usage_count?: number
}

/**
 * User feedback patterns (aggregated stats)
 */
export interface FeedbackPattern {
  totalArticles: number
  upvotedArticles: number
  downvotedArticles: number
  savedArticles: number
  archivedArticles: number
  averageRanking: number
  topTags: Array<{ tag: string, count: number }>
  topCollections: Array<{ collection: string, count: number }>
}

/**
 * Article data for persistence
 */
export interface ArticleData {
  id?: number
  url: string
  title?: string | null
  description?: string | null
  author?: string | null
  published_date?: string | null
  time_roi?: string
  ranking?: number
  status: "processing" | "unread" | "read" | "archived" | "error"
  tags?: string[]
}

/**
 * R2 storage data
 */
export interface R2Data {
  pdfKey?: string
  pdfSize?: number
  markdownKey?: string
  markdownSize?: number
  jsonKey?: string
  jsonSize?: number
}

/**
 * AI request options
 */
export interface AIRequestOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  retries?: number
}

/**
 * AI response with parsed JSON
 */
export interface AIResponse<T = any> {
  success: boolean
  data?: T
  rawResponse?: string
  error?: string
}

/**
 * Tag reconciliation result
 */
export interface TagReconciliationResult {
  tagId: number
  tagName: string
  isNew: boolean
}
