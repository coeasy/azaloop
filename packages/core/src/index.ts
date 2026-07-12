// State
export { StateManager } from './state/state-manager';
export {
  ChecksumStore,
  computeChecksum,
  computeFileChecksum,
  verifyChecksum,
  DEFAULT_ATTESTATION_CACHE_DIR,
} from './state/checksum';
export type { AttestationResult } from './state/checksum';
export { HeartbeatManager } from './state/heartbeat';
export type { Heartbeat } from './state/heartbeat';
export { RunStateManager, AuditLog } from './state/state-manager';
export type { RunState, AuditEntry } from './state/state-manager';
export { RunLedger } from './state/run-ledger';
export type { RunLedgerEntry } from './state/run-ledger';

// L1 - Spec / PRD
export { PRDGenerator } from './L1_spec/prd-generator';
export type {
  Complexity,
  CommercializationType,
  ProductCategory,
  ProductType,
  PRDGenerationInput,
  PRDGeneratorOptions,
  SelfOptimizationResult,
  PRDWithMetadata,
} from './L1_spec/prd-generator';
export { ChangeManager } from './L1_spec/change-management';
export type { ChangeProposal, SpecItem, DesignDecisions } from './L1_spec/change-management';
export { PRDChecker, DIMENSION_NAMES } from './L1_spec/prd-checker';
export type {
  ReviewDimension,
  Priority,
  PRDCheckResult,
  PRDCheckDetail,
  DimensionScore,
} from './L1_spec/prd-checker';

// L1 - Spec / PRD Review Gate (C5)
export { PRDReviewGate } from './L1_spec/prd-review-gate';
export type { PRDReviewResult, ApprovalResult } from './L1_spec/prd-review-gate';

// L2 - Memory
export { WorkingMemory } from './L2_memory/working-memory';
export { ProjectMemory } from './L2_memory/project-memory';
export type { EpisodicMemory } from './L2_memory/project-memory';
export { LongTermMemory } from './L2_memory/long-term-memory';
export type { SemanticMemory } from './L2_memory/long-term-memory';
export { SessionCatchup } from './L2_memory/session-catchup';
export type { CatchupSummary } from './L2_memory/session-catchup';
export { MemoryCompressor } from './L2_memory/compression';
export { ContextOrchestrator } from './L2_memory/context-orchestrator';
export type {
  ContextEntry,
  ContextEntryBundle,
  ContextEntryType,
  OrchestratorStory,
} from './L2_memory/context-orchestrator';
export {
  recordJournalEntry,
  getRecentJournals,
  generateSessionStartMessage,
} from './L2_memory/developer-journal';
export type { JournalEntry } from './L2_memory/developer-journal';
export { WorkspaceJournal } from './L2_memory/workspace-journal';
export type { JournalRecord } from './L2_memory/workspace-journal';
export {
  classifyTurn,
  generateCuratedManifest,
  saveCuratedManifest,
  loadCuratedManifest,
} from './L2_memory/context-manifest';
export type {
  TurnClassification,
  TurnType,
  ContextManifest,
  ContextManifestEntry,
} from './L2_memory/context-manifest';

// L3 - Roles
export { DynamicBinder } from './L3_roles/dynamic-binder';
export type { RoleName } from './L3_roles/dynamic-binder';

// L4 - Discipline
export { StrikeSystem } from './L4_discipline/strike-system';
export type { StrikeReason, StrikeRecord } from './L4_discipline/strike-system';

// L5 - Skills
export { SkillRegistry } from './L5_skill/registry';
export type { SkillMeta } from './L5_skill/registry';
export { SkillComposer } from './L5_skill/composer';
export type { ComposedSkill } from './L5_skill/composer';

// L6 - Security
export { scanSecrets } from './L6_security/scanners/secret';
export { scanSQLInjection } from './L6_security/scanners/sql-injection';
export { scanXSS } from './L6_security/scanners/xss';
export { scanDependencies } from './L6_security/scanners/dependency';
export { scanCodeInjection, securityScan } from './L6_security/scanners/code-injection';
export type { SecurityFinding } from './L6_security/scanners/secret';

// L6 - Security: Prompt Injection Scanner
export {
  scanPromptInjection,
  getInjectionRules,
  getRulesByLang,
  getRulesByCategory,
  INJECTION_RULE_COUNT,
} from './L6_security/scanners/prompt-injection';
export type {
  InjectionRule,
  PromptInjectionFinding,
  PromptInjectionScanResult,
} from './L6_security/scanners/prompt-injection';

// L6 - Security: Data Exfiltration Scanner
export {
  scanDataExfiltration,
  scanDataExfiltrationContent,
  isSensitiveDataAccess,
  isExternalSend,
  isInternalReturn,
} from './L6_security/scanners/data-exfiltration';
export type {
  SequenceStep,
  ExfiltrationChain,
  DataExfiltrationFinding,
  DataExfiltrationScanResult,
} from './L6_security/scanners/data-exfiltration';

// L6 - Security: MCP Poisoning Scanner
export {
  scanMCPTool,
  scanMCPTools,
  detectRugPulls,
  recordFingerprints,
} from './L6_security/scanners/mcp-poisoning';
export type {
  MCPToolDefinition,
  ToolFingerprint,
  MCPToolScanResult,
  RugPullResult,
} from './L6_security/scanners/mcp-poisoning';

// L6 - Security: Policy-as-Code Engine
export {
  evaluate,
  evaluateWithDefault,
  createPolicy,
  validatePolicy,
  loadPolicyFromFile,
  DEFAULT_POLICY,
} from './L6_security/policy-as-code';
export type {
  FindingKind,
  Severity as PolicySeverity,
  FailOnConfig,
  OverseasWhitelistEntry,
  SecurityPolicy,
  PolicyEvaluationResult,
} from './L6_security/policy-as-code';

// L6 - Security: China Compliance Checker
export {
  checkCompliance,
  getDomesticLLMAlternatives,
  getOverseasLLMEndpoints,
} from './L6_security/compliance-checker';
export type {
  ComplianceFramework,
  ComplianceLevel,
  ComplianceViolation,
  ComplianceSuggestion,
  ComplianceResult,
} from './L6_security/compliance-checker';

// L7 - Loop
export { StateMachine } from './L7_loop/state-machine';
export type { Stage, StageInfo, StageStatus as StageMachineStatus, PhaseLoopState, OuterLoopState, InnerLoopState, AttestationState, StateMachineState } from './L7_loop/state-machine';
export { LoopController } from './L7_loop/loop-controller';
export { StageGuards, createDefaultGuards, createPhaseGateAdapter } from './L7_loop/guards';
export type { GuardResult, GuardCheck } from './L7_loop/guards';
export { DeadlockDetector } from './L7_loop/deadlock-detector';
export type { ActionRecord } from './L7_loop/deadlock-detector';
export { HardStopManager } from './L7_loop/hard-stop';
export type { StopReason, HardStopRecord } from './L7_loop/hard-stop';
export {
  PHASE_GATES,
  evaluatePhaseGate,
  evaluateStageGate,
} from './L7_loop/phase-gates';
export type {
  PhaseGate,
  PhaseGateCheck,
  PhaseGateInput,
  PhaseGateEvaluation,
  GateCheckResult,
} from './L7_loop/phase-gates';
export {
  CircuitBreaker,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from './L7_loop/circuit-breaker';
export type {
  CircuitBreakerLevel,
  CircuitBreakerDimension,
  CircuitBreakerConfig,
  CircuitBreakerResult,
  CircuitBreakerMetrics,
  StageBreakerContext,
} from './L7_loop/circuit-breaker';
export { PhaseLoop } from './L7_loop/phase-loop';
export type {
  PhaseResult,
  IterationRecord,
  AgentRole,
  PhaseLoopOptions,
  MakerFn,
  CheckerFn,
  OptimizerFn,
} from './L7_loop/phase-loop';
export { InnerLoop } from './L7_loop/inner-loop';
export type {
  InnerLoopResult,
  InnerLoopOptions,
  StageRecord,
  StageHandlers,
  StageHandlerProvider,
} from './L7_loop/inner-loop';
export {
  createDefaultMaker,
  createDefaultChecker,
  createDefaultOptimizer,
  createDefaultHandlerProvider,
} from './L7_loop/default-handlers';
export type { DefaultHandlersOptions } from './L7_loop/default-handlers';
export { createRealHandlerProvider } from './L7_loop/real-handlers';
export type { RealHandlersOptions } from './L7_loop/real-handlers';
export { OuterLoop, defaultTriage } from './L7_loop/outer-loop';
export type {
  OuterLoopResult,
  OuterLoopOptions,
  OuterLoopPhase,
  OuterCycleRecord,
  Story,
  StoryProvider,
  StateReader,
  HumanGateFn,
  CommitFn,
  TriageFn,
} from './L7_loop/outer-loop';
export { CompletionGate, DEFAULT_BLOCK_COUNT_LIMIT } from './L7_loop/completion-gate';
export type {
  CompletionGateInput,
  CompletionGateResult,
  ConditionResult,
} from './L7_loop/completion-gate';
export {
  LoopAudit,
  SIGNAL_DEFINITIONS,
  LEVEL_THRESHOLDS,
  LEVEL_DESCRIPTIONS,
} from './L7_loop/loop-audit';
export type {
  AuditLevel,
  SignalCategory,
  SignalDefinition,
  SignalResult,
  LoopAuditResult,
  SignalInput,
} from './L7_loop/loop-audit';

// L7 - DAG Builder
export { DAGBuilder, ArtifactDAGBuilder } from './L7_loop/dag-builder';
export type {
  Task,
  DAGEdge,
  SerializedDAG,
  DAGStatusReport,
  BuildResult,
  DAGNodeType,
  DAGNodeStatus,
  DAGNode,
  ArtifactDAGStatus,
  ArtifactDAGSerialized,
} from './L7_loop/dag-builder';
// Backward-compat alias: L8DAGBuilder → ArtifactDAGBuilder (merged from L8_orchestrator)
export { ArtifactDAGBuilder as L8DAGBuilder } from './L7_loop/dag-builder';
export type { ArtifactDAGStatus as DAGStatus, ArtifactDAGSerialized as DAGSerialized } from './L7_loop/dag-builder';
export { LoopCost } from './L7_loop/loop-cost';
export type { BudgetReport, LevelCostEstimate, StageCostEstimate, LoopCostOptions } from './L7_loop/loop-cost';

// L7 - Decision Points (DP-0 to DP-7)
export { DecisionPointRegistry, contentHash, STAGE_TO_DP } from './L7_loop/decision-points';
export type { DecisionPointId, DecisionPointRecord, DPStatus } from './L7_loop/decision-points';

// L7 - SDD Dual Review (subagent-driven development)
export {
  evaluateImplementerVerdict,
  evaluateReviewerVerdict,
  evaluateDualVerdict,
  evaluateSDDReviewGate,
  saveSDDReview,
} from './L7_loop/sdd-review';
export type { VerdictResult, DualVerdict } from './L7_loop/sdd-review';

// L7 - Phase Write Guards + GitNexus Blast Radius
export { getWriteGuardConfig, isWriteAllowed, analyzeBlastRadius } from './L7_loop/write-guards';
export type { WriteGuardConfig, BlastRadiusResult } from './L7_loop/write-guards';

// L7 - Learn-from-task conventions
export { writeConventions, loadConventions, extractConventionsFromTask } from './L7_loop/learn-from-task';
export type { ConventionsEntry } from './L7_loop/learn-from-task';

// L8 - Orchestrator
// Note: DAG builders have been merged into L7_loop/dag-builder.ts.
// All L8 DAG exports (L8DAGBuilder, DAGNodeType, etc.) are now in the L7 section above.
export { ModelRouter } from './L8_orchestrator/model-router';
export type { ModelRoute, ModelTier, TaskComplexity } from './L8_orchestrator/model-router';
export { SwarmCoordinator } from './L8_orchestrator/swarm/coordinator';
export type {
  SwarmTopology,
  SwarmAgentStatus,
  SwarmAgent,
  SwarmTask,
  SwarmCoordinatorConfig,
  SwarmDispatchResult,
  SwarmCollectResult,
} from './L8_orchestrator/swarm/coordinator';

// L9 - Knowledge
export { InjectionEngine } from './L9_knowledge/injection-engine';

// Quality
export { QualityPipeline, GATE6_NAME } from './quality/pipeline';
export type { GateResult, PipelineResult, GateExecutor } from './quality/pipeline';
export { lintGate } from './quality/gates/gate1-lint';
export { testGate } from './quality/gates/gate2-test';
export { regressionGate } from './quality/gates/gate3-regression';
export type { RegressionBaseline } from './quality/gates/gate3-regression';
export { securityGate } from './quality/gates/gate4-security';
export { acceptanceGate } from './quality/gates/gate5-acceptance';
export {
  LoopAuditGate,
  loopAuditGate,
  DEFAULT_LOOP_AUDIT_MIN_SCORE,
} from './quality/gates/gate6-loop-audit';
export type { LoopAuditGateContext, LoopAuditGateResult } from './quality/gates/gate6-loop-audit';

// Continuity
export { ResumeGenerator } from './continuity/resume-generator';
export type {
  ResumeData,
  RebootQuestion,
  RebootTestResult,
  LedgerEntry,
  LedgerEntryType,
  LedgerSummary,
} from './continuity/resume-generator';
export { MCPContinueService } from './continuity/mcp-continue';
export type { MCPContinueResult } from './continuity/mcp-continue';
export { CatchupProtocol } from './continuity/catchup-protocol';
export type { CatchupResult } from './continuity/catchup-protocol';
export { ContextInjector } from './continuity/context-injector';
export type { ContextBundle } from './continuity/context-injector';
export { MCPEventSimulator } from './continuity/mcp-event-simulator';
export type { EventSimulationResult } from './continuity/mcp-event-simulator';

// L0 - Platform
export { detectClient, getClient, getAllClients } from './L0_platform/client-detection';
export type { ClientInfo } from './L0_platform/client-detection';
export { TemplateGenerator } from './L0_platform/template-generator';
export { WorkspaceManager } from './L0_platform/workspace-manager';
export type { WorkspaceInfo } from './L0_platform/workspace-manager';
export { getCompensation, getAllStrategies } from './L0_platform/compensation-strategy';
export type { CompensationStrategy } from './L0_platform/compensation-strategy';
export { getDegradationTier, getAllDegradationTiers } from './L0_platform/compensation-strategy';
export type { DegradationLevel, DegradationTier } from './L0_platform/compensation-strategy';

// Hook
export { EventBus } from './Hook/event-bus';
export type {
  HookEvent,
  EventPayload,
  EventHandler,
  MCPEventType,
  MCPEventPayload,
  MCPEventHandler,
} from './Hook/event-bus';
export { createSessionStartHandler, createOnErrorHandler, createOnStopHandler, createCompletionGateHandler, handle } from './Hook/events/lifecycle-events';
export type { CompletionGateState, CompletionGateEventResult } from './Hook/events/lifecycle-events';
export { createPreToolHandler, createPreCommitHandler, createPrePhaseHandler } from './Hook/events/pre-events';
export { createPostToolHandler, createPostTaskHandler, createPostPhaseHandler } from './Hook/events/post-events';
export { MCPEventBridge } from './Hook/mcp-event-bridge';
export type { ToolExecutor, BridgedResult } from './Hook/mcp-event-bridge';
export { registerAllHookHandlers } from './Hook/handlers';

// Config
export { ConfigLoader } from './config/config-loader';
