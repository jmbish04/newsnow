/**
 * WorkerAI - Reusable AI Service Class
 *
 * Encapsulates interactions with Cloudflare Workers AI using 3 specialized models:
 * 1. Reasoning Model: @cf/openai/gpt-oss-120b (Responses API format)
 * 2. Structured Model: @cf/meta/llama-3.3-70b-instruct-fp8-fast (JSON schema)
 * 3. Embedding Model: @cf/baai/bge-m3 (Vectorize)
 */

import type { Ai } from "@cloudflare/workers-types"

export interface WorkerAIOptions {
  retries?: number
  timeout?: number
}

export interface ReasoningResponse {
  success: boolean
  data?: string
  error?: string
}

export interface StructuredResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export interface EmbeddingResponse {
  success: boolean
  data?: number[]
  error?: string
}

/**
 * WorkerAI Class
 *
 * Provides high-level methods for AI operations:
 * - Chain of Thought reasoning
 * - Structured JSON generation
 * - Smart pipelines (reasoning -> structured)
 * - Text embeddings for RAG
 */
export class WorkerAI {
  private ai: Ai
  private defaultRetries: number

  constructor(ai: Ai, options: WorkerAIOptions = {}) {
    this.ai = ai
    this.defaultRetries = options.retries || 3
  }

  /**
   * Generate Reasoning (Chain of Thought)
   *
   * Uses GPT-OSS-120B with the Responses API format.
   * This model excels at intellectual analysis and detecting low-quality content.
   *
   * @param systemPrompt - The system instructions (maps to 'instructions')
   * @param userContent - The user input (maps to 'input')
   * @param retries - Number of retry attempts
   * @returns The raw reasoning text
   */
  async generateReasoning(
    systemPrompt: string,
    userContent: string,
    retries?: number,
  ): Promise<ReasoningResponse> {
    const maxRetries = retries ?? this.defaultRetries

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // GPT-OSS-120B uses the "Responses API" format
        const response = (await this.ai.run("@cf/openai/gpt-oss-120b", {
          instructions: systemPrompt,
          input: userContent,
        })) as { response?: string }

        if (!response.response) {
          throw new Error("Empty response from reasoning model")
        }

        return {
          success: true,
          data: response.response,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        if (attempt < maxRetries - 1) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
          continue
        }

        return {
          success: false,
          error: `Reasoning model failed after ${maxRetries} attempts: ${errorMessage}`,
        }
      }
    }

    return {
      success: false,
      error: "Reasoning model failed unexpectedly",
    }
  }

  /**
   * Generate Structured JSON
   *
   * Uses Llama 3.3 70B with strict JSON schema validation.
   * Guarantees the output matches the provided schema.
   *
   * @param systemPrompt - The system instructions
   * @param userContent - The user input
   * @param jsonSchema - The JSON schema object (must include title, type, properties, required)
   * @param retries - Number of retry attempts
   * @returns The parsed JSON object matching the schema
   */
  async generateStructured<T = unknown>(
    systemPrompt: string,
    userContent: string,
    jsonSchema: object,
    retries?: number,
  ): Promise<StructuredResponse<T>> {
    const maxRetries = retries ?? this.defaultRetries

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Llama 3.3 70B uses standard chat messages + response_format
        const response = (await this.ai.run(
          "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
          {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
            response_format: {
              type: "json_schema",
              json_schema: jsonSchema,
            },
          },
        )) as { response?: string }

        if (!response.response) {
          throw new Error("Empty response from structured model")
        }

        // Parse the JSON response
        const parsed = JSON.parse(response.response) as T

        return {
          success: true,
          data: parsed,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        if (attempt < maxRetries - 1) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
          continue
        }

        return {
          success: false,
          error: `Structured model failed after ${maxRetries} attempts: ${errorMessage}`,
        }
      }
    }

    return {
      success: false,
      error: "Structured model failed unexpectedly",
    }
  }

  /**
   * Generate Structured Reasoning (Smart Pipeline)
   *
   * Two-stage process:
   * 1. Use reasoning model (GPT-OSS-120B) for Chain of Thought analysis
   * 2. Use structured model (Llama 3.3 70B) to convert reasoning into JSON
   *
   * This approach combines the intellectual depth of the reasoning model
   * with the strict structure enforcement of the JSON schema model.
   *
   * @param systemPrompt - The initial system prompt for reasoning
   * @param userContent - The content to analyze
   * @param jsonSchema - The JSON schema for the final output
   * @param retries - Number of retry attempts
   * @returns The parsed JSON object derived from the reasoning
   */
  async generateStructuredReasoning<T = unknown>(
    systemPrompt: string,
    userContent: string,
    jsonSchema: object,
    retries?: number,
  ): Promise<StructuredResponse<T>> {
    // Step 1: Generate Chain of Thought reasoning
    const reasoningResult = await this.generateReasoning(
      systemPrompt,
      userContent,
      retries,
    )

    if (!reasoningResult.success || !reasoningResult.data) {
      return {
        success: false,
        error: `Reasoning stage failed: ${reasoningResult.error}`,
      }
    }

    // Step 2: Convert reasoning into structured JSON
    const structuredSystemPrompt = `You are a JSON formatter. Convert the provided reasoning into a JSON object that matches the schema exactly.`

    const structuredUserPrompt = `Based on the following reasoning:

${reasoningResult.data}

Generate the final JSON object matching the schema.`

    const structuredResult = await this.generateStructured<T>(
      structuredSystemPrompt,
      structuredUserPrompt,
      jsonSchema,
      retries,
    )

    if (!structuredResult.success) {
      return {
        success: false,
        error: `Structured stage failed: ${structuredResult.error}`,
      }
    }

    return structuredResult
  }

  /**
   * Generate Text Embeddings
   *
   * Uses BGE-M3 to convert text into vector representations for RAG.
   * These vectors are used with Vectorize for semantic search.
   *
   * @param text - The text to convert into embeddings
   * @param retries - Number of retry attempts
   * @returns The embedding vector (number array)
   */
  async generateEmbeddings(
    text: string,
    retries?: number,
  ): Promise<EmbeddingResponse> {
    const maxRetries = retries ?? this.defaultRetries

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = (await this.ai.run("@cf/baai/bge-m3", {
          text: [text],
        })) as { data?: number[][] }

        if (!response.data || !response.data[0]) {
          throw new Error("Empty response from embedding model")
        }

        return {
          success: true,
          data: response.data[0],
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        if (attempt < maxRetries - 1) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
          continue
        }

        return {
          success: false,
          error: `Embedding model failed after ${maxRetries} attempts: ${errorMessage}`,
        }
      }
    }

    return {
      success: false,
      error: "Embedding model failed unexpectedly",
    }
  }
}
