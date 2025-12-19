# Article Agent System

A personal news aggregator powered by AI agents that processes raw URLs, analyzes content, and provides intelligent "Time ROI" recommendations.

## Overview

This system transforms NewsNow into an intelligent article processing platform using:

- **Cloudflare Agents SDK** (Durable Objects) - Individual agents for each article
- **Cloudflare D1** - SQLite database for article metadata and collections
- **Cloudflare R2** - Object storage for PDF, Markdown, and JSON artifacts
- **Cloudflare Browser Rendering REST API** - PDF and Markdown generation via HTTP endpoints
- **Workers AI** - LLM-powered content analysis, ranking, and metadata extraction
- **Cloudflare Queues** - Asynchronous URL ingestion

## Features

### 🤖 AI-Powered Analysis

Each article is analyzed by an AI agent that:

- Extracts title, author, date, and main topics from Markdown content
- Generates a concise summary
- Calculates "Time ROI" (is it slop or deep work?)
- Assigns a 1-100 ranking score based on your interests
- Suggests relevant tags

The AI performs metadata extraction directly from the article's Markdown content, eliminating the need for DOM manipulation and ensuring consistent extraction across all articles.

### 📚 Collections (Human-in-the-Loop)

Create collections to train the AI on your interests:

```json
{
  "name": "Rust Performance",
  "description": "Deep dives into memory management and zero-cost abstractions"
}
```

The AI uses your collections to:
- Rank articles higher if they match your interests
- Identify quality content vs. generic content
- Learn from your feedback over time

### 📄 Artifact Storage

Each article is processed and stored as:

- **PDF** - Full page render for offline reading
- **Markdown** - Clean text extraction
- **JSON** - Metadata + AI analysis

### 🔄 Chrome iOS URL Support

Handles the iOS Chrome behavior where copying multiple tabs creates a space-separated string:

```
https://example.com/article1 https://example.com/article2 https://example.com/article3
```

## API Endpoints

### Ingest URLs

```bash
POST /api/agent/ingest
Content-Type: application/json

{
  "text": "https://example.com/article1 https://example.com/article2"
}
```

### Get Feed

```bash
GET /api/agent/feed?status=unread&limit=50&min_ranking=70
```

Query parameters:
- `status` - Filter by status (unread, read, archived)
- `limit` - Number of articles (default: 50, max: 200)
- `offset` - Pagination offset
- `collection_id` - Filter by collection
- `tag` - Filter by tag name
- `min_ranking` - Minimum ranking score (1-100)

### Provide Feedback

```bash
POST /api/agent/feedback
Content-Type: application/json

{
  "article_id": 123,
  "feedback_type": "upvote",
  "score": 95,
  "tags": ["rust", "performance"],
  "collection_id": 5,
  "notes": "Excellent insights on memory management"
}
```

Feedback types:
- `upvote` - Increase ranking by 10
- `downvote` - Decrease ranking by 10
- `saved` - Mark as read and increase ranking by 5
- `archived` - Archive the article
- `tag_added` / `tag_removed` - Manage tags

### Manage Collections

```bash
# Get all collections
GET /api/agent/collections

# Create a collection
POST /api/agent/collections
Content-Type: application/json

{
  "name": "Rust Performance",
  "description": "Deep dives into memory management",
  "color": "#ff6b6b"
}
```

### Download Artifacts

```bash
# Download PDF
GET /api/agent/article/123/artifact/pdf

# Download Markdown
GET /api/agent/article/123/artifact/md

# Download JSON metadata
GET /api/agent/article/123/artifact/json
```

## Database Schema

### Tables

- `articles` - Article metadata and AI analysis
- `article_tags` - Tag definitions
- `article_tag_map` - Many-to-many article-tag relationships
- `article_r2_objects` - R2 storage references
- `collections` - User-defined interest categories
- `collection_items` - Articles in collections
- `article_feedback` - User feedback history for AI training

## Setup

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Browser Rendering API Credentials

Set your Cloudflare account ID and API token as secrets:

```bash
# Get your Account ID from the Cloudflare dashboard
# Create an API token with "Browser Rendering" permissions
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_API_TOKEN
```

**Note:** The Browser Rendering REST API requires these credentials to authenticate requests. The ArticleAgent uses these to call the `/markdown` and `/pdf` endpoints.

### 3. Create Cloudflare Resources

```bash
# Create R2 bucket
npx wrangler r2 bucket create newsnow-articles

# Create queues
npx wrangler queues create article-ingestion-queue
npx wrangler queues create article-ingestion-dlq

# D1 database should already exist from wrangler.toml
```

### 4. Run Database Migrations

```bash
# For local development
npx wrangler d1 execute NEWSNOW_DB --local --file=./migrations/0001_create_article_tables.sql

# For production
npx wrangler d1 execute NEWSNOW_DB --remote --file=./migrations/0001_create_article_tables.sql
```

Or use the helper script:

```bash
npx tsx ./scripts/init-article-db.ts
```

### 5. Create Your First Collection

This helps the AI understand your interests:

```bash
curl -X POST http://localhost:3000/api/agent/collections \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Rust Performance",
    "description": "Deep technical articles about Rust memory management and zero-cost abstractions"
  }'
```

### 6. Start Development Server

```bash
npm run dev
```

## Usage Example

### 1. Copy URLs from Chrome iOS

When you have multiple tabs open in Chrome iOS, select all and copy. You'll get a space-separated string of URLs.

### 2. Submit to Ingestion Endpoint

```bash
curl -X POST http://localhost:3000/api/agent/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "text": "https://blog.rust-lang.org/article1 https://example.com/article2"
  }'
```

Response:
```json
{
  "success": true,
  "message": "Queued 2 article(s) for processing",
  "urls": ["https://blog.rust-lang.org/article1", "https://example.com/article2"],
  "total_found": 2,
  "total_queued": 2
}
```

### 3. Check Your Feed

```bash
curl http://localhost:3000/api/agent/feed?status=unread&limit=10
```

Response:
```json
{
  "success": true,
  "articles": [
    {
      "id": 1,
      "url": "https://blog.rust-lang.org/article1",
      "title": "Advanced Memory Management in Rust",
      "description": "Deep dive into ownership and borrowing",
      "time_roi": "High ROI: Comprehensive technical analysis with actionable insights on Rust's memory model",
      "ranking": 95,
      "status": "unread",
      "tags": [
        { "name": "rust", "description": null },
        { "name": "performance", "description": null }
      ]
    }
  ],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "total": 1,
    "has_more": false
  }
}
```

### 4. Provide Feedback

```bash
curl -X POST http://localhost:3000/api/agent/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "article_id": 1,
    "feedback_type": "saved",
    "collection_id": 1,
    "notes": "Great resource for understanding ownership"
  }'
```

## Architecture

### Article Processing Flow

```
1. User submits URLs → Queue
2. Queue Consumer picks up message
3. ArticleAgent Durable Object spawned
4. Browser Rendering REST API calls:
   - POST /markdown → Get Markdown content
   - POST /pdf → Get PDF binary
5. AI Analysis:
   - Extract metadata (title, author, date) from Markdown
   - Generate summary, topics, and ranking
   - Calculate "Time ROI" score
6. R2 Storage (save PDF, Markdown, and JSON artifacts)
7. D1 Update (article record with AI insights)
8. Article appears in feed
```

### Durable Objects

Each article gets its own `ArticleAgent` Durable Object identified by its URL. This ensures:

- **No duplicate processing** - Same URL always maps to same DO
- **Stateful processing** - Agent maintains processing state
- **Feedback handling** - Agent can receive and process user feedback

### AI Context

The AI receives:
- All active collections (to understand user interests)
- Article content (truncated to 8000 chars)
- Prompt asking to analyze value, depth, and relevance

This allows the AI to distinguish between:
- 🟢 **High ROI**: Deep technical content, original research, actionable insights
- 🟡 **Medium ROI**: Useful but generic content
- 🔴 **Low ROI**: Clickbait, shallow content, rehashed information

## Frontend Integration

The frontend should:

1. Display `time_roi` prominently (this is the key differentiator)
2. Show `ranking` as a visual indicator (1-100 score)
3. Allow users to create/manage collections
4. Provide feedback buttons (upvote, downvote, save, archive)
5. Support tag management
6. Allow downloading PDF/MD/JSON artifacts

## Performance Considerations

- Queue batching processes up to 10 URLs at once
- Browser Rendering REST API calls have 30-second timeout
- AI content is truncated to 8000 characters for token limits
- Metadata extraction happens via AI (no DOM manipulation overhead)
- R2 artifacts are cached with 1-hour TTL
- D1 queries use indexes for fast lookups
- REST API approach eliminates browser instance management overhead

## Future Enhancements

- [ ] Email digest of high-ranking articles
- [ ] Browser extension for one-click ingestion
- [ ] Mobile app with sharing integration
- [ ] Collaborative collections (share with team)
- [ ] Advanced AI models (switch between Llama, GPT, Claude)
- [ ] Semantic search across articles
- [ ] Automatic categorization into collections
- [ ] Reading time estimates
- [ ] Related article suggestions

## Troubleshooting

### Queue messages not processing

Check queue status:
```bash
npx wrangler queues list
```

### Database errors

Verify tables were created:
```bash
npx wrangler d1 execute NEWSNOW_DB --local --command="SELECT name FROM sqlite_master WHERE type='table'"
```

### R2 storage errors

Verify bucket exists:
```bash
npx wrangler r2 bucket list
```

### Browser Rendering API errors

Verify your credentials are set:
```bash
wrangler secret list
```

If you see authentication errors, recreate your API token with "Browser Rendering" permissions.

Adjust timeout in `article-agent.ts` if needed:
```typescript
// In renderWithBrowserAPI method, update the fetch body:
body: JSON.stringify({
  url,
  wait_for: "networkidle",
  timeout: 60000 // Increase to 60 seconds if needed
})
```

### API Rate Limits

The Browser Rendering API has rate limits based on your plan. If you encounter rate limit errors:
1. Reduce queue batch size in `wrangler.toml` (currently 10)
2. Add retry logic with exponential backoff
3. Upgrade your Cloudflare plan for higher limits

## License

Same as parent project (MIT)
