/**
 * Agent System Exports
 *
 * This module exports all agents and types for the NewsNow Agent system.
 *
 * Architecture:
 * - BaseAgent: Foundation class with shared utilities
 * - OrchestratorAgent: Workflow coordination
 * - EvaluatorOptimizerAgent: Quality control and re-evaluation
 * - HumanInTheLoopAgent: Learning from user feedback
 *
 * All agents extend BaseAgent to inherit:
 * - Global context awareness (D1 reads)
 * - Intelligent tag reconciliation
 * - Knowledge persistence (D1 writes)
 * - AI wrapper with error handling
 */

export { BaseAgent } from "./base"
export type { AgentEnv, VectorSearchResult } from "./base"

export { OrchestratorAgent } from "./orchestrator"
export { EvaluatorOptimizerAgent } from "./evaluator"
export { HumanInTheLoopAgent } from "./human-feedback"
export type { FeedbackType, UserFeedback } from "./human-feedback"

export { RAGAgent } from "./rag-agent"
export type { RAGQueryResult, RAGResponse } from "./rag-agent"

export type {
  AIRequestOptions,
  AIResponse,
  ArticleData,
  Collection,
  FeedbackPattern,
  GlobalContext,
  R2Data,
  TagReconciliationResult,
  TagRegistryEntry,
} from "./types"
