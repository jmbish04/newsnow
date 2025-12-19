/**
 * Cloudflare Workers Bindings
 * Type definitions for all Cloudflare services used in the article agent system
 */

import type { D1Database, DurableObjectNamespace, Queue, R2Bucket } from "@cloudflare/workers-types"
import type { Ai } from "@cloudflare/ai"

export interface Env {
  // D1 Database
  NEWSNOW_DB: D1Database

  // R2 Storage for articles (PDF, Markdown, JSON)
  ARTICLE_STORAGE: R2Bucket

  // Queue for article ingestion
  ARTICLE_QUEUE: Queue

  // Workers AI
  AI: Ai

  // Browser Rendering
  BROWSER: any // Puppeteer browser instance

  // Durable Object namespace for Article Agents
  ARTICLE_AGENT: DurableObjectNamespace
}

/**
 * Article data structure
 */
export interface Article {
  id?: number
  url: string
  title?: string
  description?: string
  author?: string
  published_date?: string
  time_roi?: string // AI analysis of time investment
  ranking?: number // 1-100 score
  status: "processing" | "unread" | "read" | "archived" | "error"
  created_at?: number
  updated_at?: number
}

/**
 * Article tag structure
 */
export interface ArticleTag {
  id?: number
  name: string
  description?: string
  is_active: boolean
  created_at?: number
}

/**
 * R2 object reference
 */
export interface ArticleR2Object {
  id?: number
  article_id: number
  r2_key: string
  file_type: "pdf" | "md" | "json"
  file_size?: number
  created_at?: number
}

/**
 * Collection structure
 */
export interface Collection {
  id?: number
  name: string
  description?: string
  color?: string
  is_active: boolean
  created_at?: number
  updated_at?: number
}

/**
 * Queue message for article ingestion
 */
export interface ArticleQueueMessage {
  url: string
  source?: string
  priority?: number
}

/**
 * AI analysis result
 */
export interface AIAnalysisResult {
  title?: string
  author?: string
  published_date?: string
  summary: string
  main_topics: string[]
  time_roi: string
  ranking: number
  reasoning: string
  suggested_tags: string[]
}

/**
 * Browser rendering result
 */
export interface BrowserRenderResult {
  pdf_buffer: ArrayBuffer
  markdown: string
  metadata: {
    title?: string
    author?: string
    published_date?: string
    description?: string
  }
}

/**
 * Feedback data structure
 */
export interface FeedbackData {
  article_id: number
  feedback_type: "upvote" | "downvote" | "saved" | "archived" | "tag_added" | "tag_removed"
  tags?: string[]
  score?: number
  collection_id?: number
  notes?: string
}
