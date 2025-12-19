# Agentic RAG System - Documentation

## Overview

The Agentic RAG (Retrieval-Augmented Generation) system provides intelligent question-answering over your personal news feed. It uses a multi-stage AI workflow to understand your questions, retrieve relevant articles, and synthesize accurate answers with citations.

## Architecture

### Components

1. **RAGAgent** (`src/agents/rag-agent.ts`) - Core intelligence
2. **WorkerAI Service** (`src/utils/worker-ai.ts`) - Multi-model AI orchestration
3. **API Endpoint** (`server/api/agent/agentic-query.post.ts`) - HTTP interface
4. **AgenticSearch Component** (`src/components/AgenticSearch.tsx`) - User interface
5. **Search Route** (`src/routes/search.tsx`) - Dedicated page at `/search`

### Multi-Stage Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│  Stage 1: Intent Analysis                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Input: "Hey, what are the AI trends?"               │   │
│  │ Reasoning Model: @cf/openai/gpt-oss-120b           │   │
│  │ Output: "AI trends artificial intelligence"         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  Stage 2: Semantic Retrieval                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Embedding Model: @cf/baai/bge-m3                    │   │
│  │ Query: Vectorize index                              │   │
│  │ Result: Top 10 relevant articles                    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  Stage 3: Context Construction                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Enrich with D1 data (title, author, tags, etc.)    │   │
│  │ Format as structured context blocks                 │   │
│  │ Include relevance scores and metadata               │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  Stage 4: Structured Reasoning Synthesis                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Step A: Deep Analysis                               │   │
│  │   Model: @cf/openai/gpt-oss-120b                   │   │
│  │   Task: Analyze context and synthesize answer       │   │
│  │                                                      │   │
│  │ Step B: JSON Structuring                            │   │
│  │   Model: @cf/meta/llama-3.3-70b-instruct-fp8-fast  │   │
│  │   Task: Convert reasoning to validated JSON         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  Output: Structured Answer                                  │
│  {                                                           │
│    "thinking_process": "...",                               │
│    "answer_markdown": "...",                                │
│    "confidence_score": 85,                                  │
│    "cited_article_ids": [1, 5, 12],                        │
│    "follow_up_suggestions": [...]                          │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
```

## AI Models

### 1. Reasoning Model: `@cf/openai/gpt-oss-120b`

**Purpose:** Deep intellectual analysis and Chain of Thought reasoning

**API Format:** Responses API
```typescript
{
  instructions: "System prompt",
  input: "User input"
}
```

**Use Cases:**
- Query optimization (removing fluff, extracting core concepts)
- Deep analysis of article context
- Detecting low-quality "slop" content

**Why This Model:**
- Excels at intellectual reasoning
- Better at understanding nuance than smaller models
- Provides detailed thinking process

### 2. Structured Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`

**Purpose:** Strict JSON schema validation and structured output

**API Format:** Standard chat with JSON schema
```typescript
{
  messages: [
    { role: "system", content: "..." },
    { role: "user", content: "..." }
  ],
  response_format: {
    type: "json_schema",
    json_schema: { ... }
  }
}
```

**Use Cases:**
- Converting reasoning into structured JSON
- Guaranteeing output matches required schema
- Final answer formatting

**Why This Model:**
- Fast inference (fp8 quantization)
- Excellent JSON schema adherence
- Good balance of quality and speed

### 3. Embedding Model: `@cf/baai/bge-m3`

**Purpose:** Text-to-vector conversion for semantic search

**API Format:**
```typescript
{
  text: ["Article content to embed"]
}
```

**Use Cases:**
- Converting user queries to vectors
- Indexing articles for semantic search
- Finding semantically similar content

**Why This Model:**
- Multilingual support
- High-quality embeddings
- Optimized for Vectorize

## Smart Pipeline: `generateStructuredReasoning()`

The "smart pipeline" combines the reasoning and structured models for best-of-both-worlds output:

### Step 1: Reasoning (GPT-OSS-120B)
```typescript
const reasoning = await generateReasoning(
  systemPrompt,
  userContent
)
// Result: Deep analysis in natural language
```

### Step 2: Structuring (Llama 3.3 70B)
```typescript
const structured = await generateStructured(
  "You are a JSON formatter...",
  `Based on the following reasoning:\n\n${reasoning}\n\nGenerate JSON...`,
  jsonSchema
)
// Result: Validated JSON object
```

### Benefits:
1. **Intellectual Depth:** Reasoning model provides thorough analysis
2. **Schema Compliance:** Structured model ensures valid JSON
3. **Error Recovery:** If reasoning fails, structured model can still work
4. **Transparency:** Thinking process is preserved in the output

## Usage

### Backend API

```typescript
// POST /api/agent/agentic-query
const response = await fetch('/api/agent/agentic-query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: "What are the main AI trends in my feed?",
    limit: 10  // optional, max 50
  })
})

const result = await response.json()
/*
{
  "success": true,
  "query": "What are the main AI trends in my feed?",
  "answer": {
    "thinking_process": "I analyzed 8 articles...",
    "answer_markdown": "**Three main AI trends:**\n1. ...",
    "confidence_score": 85,
    "cited_article_ids": [1, 5, 12],
    "follow_up_suggestions": [
      "Tell me more about AI safety concerns",
      "What are companies saying about AI regulation?",
      "Show me articles about AI in healthcare"
    ]
  },
  "retrieved_articles": [...],
  "metadata": {
    "retrieval_count": 10,
    "cited_count": 3,
    "confidence": 85
  }
}
*/
```

### Frontend Component

```tsx
import { AgenticSearch } from '~/components/AgenticSearch'

function MyPage() {
  return (
    <div>
      <h1>Ask Your News Feed</h1>
      <AgenticSearch />
    </div>
  )
}
```

### Direct Agent Usage

```typescript
import { RAGAgent } from '~/src/agents/rag-agent'

const agent = new RAGAgent(
  {
    NEWSNOW_DB: env.NEWSNOW_DB,
    AI: env.AI,
    VECTOR_INDEX: env.VECTOR_INDEX
  },
  {} // SQL state
)

const result = await agent.answerQuery(
  "What are the latest developments in quantum computing?",
  10
)
```

## Response Schema

### RAGQueryResult

```typescript
interface RAGQueryResult {
  // How the AI synthesized the answer from the articles
  thinking_process: string

  // Final answer in Markdown format (supports **bold**, *italic*, `code`)
  answer_markdown: string

  // Confidence score from 0-100
  // - 70-100: High confidence (green badge)
  // - 40-69: Medium confidence (yellow badge)
  // - 0-39: Low confidence (red badge)
  confidence_score: number

  // IDs of articles that were actually cited in the answer
  // Note: Retrieved articles may be more than cited articles
  cited_article_ids: number[]

  // 3 suggested follow-up questions based on the context
  follow_up_suggestions: string[]
}
```

## Error Handling

### Zero Results

When no articles match the query:

```json
{
  "thinking_process": "No relevant articles found in the knowledge base.",
  "answer_markdown": "I couldn't find any articles in your feed related to this question...",
  "confidence_score": 0,
  "cited_article_ids": [],
  "follow_up_suggestions": [
    "What articles do I have in my feed?",
    "Show me recent articles",
    "What topics do my articles cover?"
  ]
}
```

### Query Optimization Failure

If intent analysis fails, the system falls back to the original query:

```typescript
// Optimization attempt fails
// Fallback: Use user's original question directly
return userQuestion
```

### AI Model Failure

All AI calls include retry logic with exponential backoff:

```typescript
for (let attempt = 0; attempt < maxRetries; attempt++) {
  try {
    // AI call
  } catch (error) {
    if (attempt < maxRetries - 1) {
      // Wait: 1s, 2s, 3s
      await sleep(1000 * (attempt + 1))
    }
  }
}
```

## Best Practices

### Query Writing

**Good Questions:**
- "What are the main themes in my AI articles?"
- "Summarize the latest quantum computing developments"
- "What do experts say about climate change solutions?"

**Avoid:**
- Too vague: "What's new?"
- Too specific: "What did John Smith say on page 3 of article X?"
- Outside scope: "What's the weather today?"

### Citation Trust

- **High Confidence (70-100%):** AI found clear, direct information
- **Medium Confidence (40-69%):** AI synthesized from multiple sources
- **Low Confidence (0-39%):** AI is uncertain or extrapolating

**Always click through to cited articles** to verify information in context.

### Performance Optimization

1. **Limit Results:** Use `limit` parameter (default: 10, max: 50)
   - Smaller limits = faster responses
   - Larger limits = more comprehensive context

2. **Specific Queries:** More specific questions get better results
   - Good: "AI safety concerns in language models"
   - Bad: "Tell me about AI"

3. **Follow-up Questions:** Use suggested follow-ups for faster exploration
   - Pre-optimized queries
   - Relevant to current context

## Technical Details

### Vector Search

Articles are automatically indexed when saved:

```typescript
// In BaseAgent.saveArticleAnalysis()
const textForEmbedding = [
  articleData.title || "",
  articleData.description || "",
  (articleData.tags || []).join(" ")
].filter(Boolean).join(" ")

await this.saveToKnowledgeBase(articleId, textForEmbedding, metadata)
```

### Context Enrichment

Retrieved articles are enriched with full data:

```typescript
// Vector search returns: { id, score, metadata }
// Enrichment adds: { article: { title, author, tags, ... } }
const enriched = await Promise.all(
  results.map(async (result) => {
    const article = await getArticleById(result.metadata.articleId)
    const tags = await getArticleTags(result.metadata.articleId)
    return { ...result, article: { ...article, tags } }
  })
)
```

### Markdown Rendering

Frontend uses basic HTML conversion:

```typescript
answer_markdown
  .replace(/\n/g, "<br />")
  .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
  .replace(/\*(.*?)\*/g, "<em>$1</em>")
  .replace(/`(.*?)`/g, "<code>$1</code>")
```

For production, consider using a proper Markdown parser like `marked` or `react-markdown`.

## Troubleshooting

### "No articles found"

**Cause:** Vectorize index is empty or query doesn't match any articles

**Solution:**
1. Ensure articles are being indexed (check `saveArticleAnalysis()`)
2. Try broader queries
3. Verify Vectorize binding is configured correctly

### Low confidence scores

**Cause:** Articles don't directly address the question

**Solution:**
1. Refine your question
2. Add more articles to your feed
3. Check if cited articles actually contain the information

### Slow responses

**Cause:** Multi-stage AI pipeline is computationally intensive

**Optimization:**
1. Reduce `limit` parameter (fewer articles to process)
2. Use more specific queries (faster retrieval)
3. Monitor Cloudflare Workers AI usage/limits

## Future Enhancements

- [ ] Streaming responses for real-time "thinking" display
- [ ] Multi-turn conversations with context preservation
- [ ] User feedback loop for improving answer quality
- [ ] Custom system prompts per user
- [ ] Answer caching for repeated queries
- [ ] Source snippet extraction (show relevant quotes)
- [ ] Export answers as markdown/PDF
- [ ] Scheduled digest generation

## References

- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Vectorize Documentation](https://developers.cloudflare.com/vectorize/)
- [RAG Best Practices](https://www.anthropic.com/index/retrieval-augmented-generation)
