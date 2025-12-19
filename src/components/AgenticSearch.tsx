/**
 * AgenticSearch - Intelligent RAG Search Interface
 *
 * A polished React component for asking questions about your news feed.
 * Features:
 * - Large search bar with natural language input
 * - Loading states with "AI is thinking" indicator
 * - Markdown-rendered answers with citations
 * - Confidence score badges
 * - Clickable follow-up suggestions
 */

import { useState } from "react"
import { myFetch } from "~/src/utils"

interface RAGQueryResult {
  thinking_process: string
  answer_markdown: string
  confidence_score: number
  cited_article_ids: number[]
  follow_up_suggestions: string[]
}

interface RetrievedArticle {
  id: string
  score: number
  article: {
    id: number
    url: string
    title: string
    description?: string
    author?: string
    published_date?: string
    ranking?: number
    tags?: string[]
  } | null
}

interface AgenticQueryResponse {
  success: boolean
  query: string
  answer?: RAGQueryResult
  retrieved_articles?: RetrievedArticle[]
  metadata?: {
    retrieval_count: number
    cited_count: number
    confidence: number
  }
  error?: string
}

export function AgenticSearch() {
  const [query, setQuery] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<AgenticQueryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) return

    setIsLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await myFetch<AgenticQueryResponse>("/agent/agentic-query", {
        method: "POST",
        body: JSON.stringify({ query: searchQuery, limit: 10 }),
      })

      if (response.success) {
        setResult(response)
      } else {
        setError(response.error || "Query failed")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch results")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleSearch(query)
  }

  const handleFollowUpClick = (suggestion: string) => {
    setQuery(suggestion)
    handleSearch(suggestion)
  }

  const getConfidenceColor = (score: number) => {
    if (score >= 70) return "bg-green-100 text-green-800 border-green-300"
    if (score >= 40) return "bg-yellow-100 text-yellow-800 border-yellow-300"
    return "bg-red-100 text-red-800 border-red-300"
  }

  const getConfidenceLabel = (score: number) => {
    if (score >= 70) return "High Confidence"
    if (score >= 40) return "Medium Confidence"
    return "Low Confidence"
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Search Bar */}
      <form onSubmit={handleSubmit} className="mb-8">
        <div className="flex flex-col gap-4">
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Ask me anything about your news feed..."
              className="w-full rounded-lg border-2 border-gray-300 bg-white px-6 py-4 text-lg shadow-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              disabled={isLoading}
            />
            {isLoading && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="rounded-lg bg-blue-600 px-8 py-3 text-lg font-semibold text-white shadow-md transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "Thinking..." : "Search"}
          </button>
        </div>
      </form>

      {/* Loading State */}
      {isLoading && (
        <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-8 text-center">
          <div className="mb-4 flex justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          </div>
          <p className="text-lg font-medium text-blue-900">
            AI is analyzing your articles...
          </p>
          <p className="mt-2 text-sm text-blue-700">
            Searching knowledge base and synthesizing answer
          </p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-6">
          <h3 className="mb-2 text-lg font-semibold text-red-900">Error</h3>
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Results */}
      {result?.answer && (
        <div className="space-y-6">
          {/* Answer Section */}
          <div className="rounded-lg border-2 border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Answer</h2>
              <div
                className={`rounded-full border-2 px-4 py-1.5 text-sm font-semibold ${getConfidenceColor(result.answer.confidence_score)}`}
              >
                {getConfidenceLabel(result.answer.confidence_score)}
                {" "}
                (
                {result.answer.confidence_score}
                %)
              </div>
            </div>

            {/* Markdown Answer */}
            <div className="prose prose-lg max-w-none">
              <div
                className="text-gray-800"
                dangerouslySetInnerHTML={{
                  __html: result.answer.answer_markdown
                    .replace(/\n/g, "<br />")
                    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                    .replace(/\*(.*?)\*/g, "<em>$1</em>")
                    .replace(/`(.*?)`/g, "<code>$1</code>"),
                }}
              />
            </div>

            {/* Thinking Process (Collapsible) */}
            {result.answer.thinking_process && (
              <details className="mt-6 rounded-lg bg-gray-50 p-4">
                <summary className="cursor-pointer font-semibold text-gray-700">
                  🧠 How I arrived at this answer
                </summary>
                <p className="mt-3 text-sm text-gray-600">
                  {result.answer.thinking_process}
                </p>
              </details>
            )}
          </div>

          {/* Citations */}
          {result.retrieved_articles && result.retrieved_articles.length > 0 && (
            <div className="rounded-lg border-2 border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-xl font-bold text-gray-900">
                📚 Sources (
                {result.answer.cited_article_ids.length}
                {" "}
                cited)
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                {result.retrieved_articles
                  .filter(a => result.answer?.cited_article_ids.includes(a.article?.id || 0))
                  .map((item) => {
                    if (!item.article) return null

                    return (
                      <a
                        key={item.article.id}
                        href={item.article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group rounded-lg border-2 border-gray-200 bg-gray-50 p-4 transition-all hover:border-blue-400 hover:bg-blue-50"
                      >
                        <div className="mb-2 flex items-start justify-between">
                          <h4 className="flex-1 font-semibold text-gray-900 group-hover:text-blue-600">
                            {item.article.title || "Untitled"}
                          </h4>
                          <span className="ml-2 rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800">
                            {(item.score * 100).toFixed(0)}
                            % match
                          </span>
                        </div>
                        {item.article.description && (
                          <p className="mb-2 line-clamp-2 text-sm text-gray-600">
                            {item.article.description}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {item.article.author && (
                            <span className="text-xs text-gray-500">
                              By
                              {" "}
                              {item.article.author}
                            </span>
                          )}
                          {item.article.tags && item.article.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {item.article.tags.slice(0, 3).map(tag => (
                                <span
                                  key={tag}
                                  className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </a>
                    )
                  })}
              </div>
            </div>
          )}

          {/* Follow-up Suggestions */}
          {result.answer.follow_up_suggestions && result.answer.follow_up_suggestions.length > 0 && (
            <div className="rounded-lg border-2 border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-xl font-bold text-gray-900">
                💡 Follow-up Questions
              </h3>
              <div className="flex flex-wrap gap-3">
                {result.answer.follow_up_suggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={() => handleFollowUpClick(suggestion)}
                    className="rounded-lg border-2 border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-all hover:border-blue-400 hover:bg-blue-100"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
