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

// L1 - GitHub competitive research (0.4.0)
export {
  researchCompetitors,
  runCompetitiveResearch,
  writeCompetitiveResearch,
  writePrdMarkdown,
  getCuratedCompetitorsSync,
  buildCompetitiveAppendixSync,
  DEFAULT_DIFFERENTIATORS,
} from './L1_spec/github-competitive-research';
export type {
  CompetitorHit,
  CompetitiveResearchResult,
  CompetitorResearchMode,
  RunCompetitiveResearchResult,
} from './L1_spec/github-competitive-research';

export { runMultiRolePrdReview } from './L1_spec/prd-multi-role-review';
export type { ReviewRole, RoleFinding, MultiRoleReviewResult } from './L1_spec/prd-multi-role-review';

// L1 - Spec / PRD TodoList Generator
export { PrdTodolistGenerator, generatePrdTodolist } from './L1_spec/prd-todolist-generator';
export type { TodoItem, TodoList } from './L1_spec/prd-todolist-generator';

export {
  ensureConstitution,
  readConstitution,
  writeConstitution,
  writePlanMd,
  readPlanMd,
  DEFAULT_CONSTITUTION,
} from './L1_spec/constitution';

export { listPresets, getPreset, applyPreset } from './L0_platform/presets';
export type { AzaPreset } from './L0_platform/presets';

export { runUiQa } from './L6_security/ui-qa';
export type { UiQaResult, UiQaOptions } from './L6_security/ui-qa';

export {
  loadFederation,
  registerFederationPeer,
  syncFederationDigest,
} from './L8_orchestrator/federation';
export type { FederationManifest, FederationPeer } from './L8_orchestrator/federation';

// L1 - Spec / Execution Contract (T17 / spec-superflow pattern)
export {
  generateExecutionContract,
  writeContract,
  loadContract,
  contentHashContract,
  contractToMarkdown,
} from './L1_spec/execution-contract';
export type { ExecutionContract, TaskBatch } from './L1_spec/execution-contract';

// L1 - OpenSpec Change Folder (T23 / ralphy-openspec pattern)
export {
  scaffoldChange,
  writeChangeFolder,
  archiveChange,
  listChanges,
  CHANGE_FOLDER_FINGERPRINT,
} from './L1_spec/change-folder';
export type { ChangeInput, ChangeFolder, ChangeListEntry, ChangeTaskInput } from './L1_spec/change-folder';

// L1 - Architecture Decision Records (v13 P2.1 / Trellis MADR pattern)
export {
  createAdr,
  listAdrs,
  getAdr,
  updateAdr,
  nextAdrId,
  parseAdr,
  scanDiff,
  adrDir,
  adrFilename,
} from './L1_spec/adr';
export type {
  Adr,
  AdrStatus,
  CreateAdrInput,
  UpdateAdrPatch,
  ScanDiffResult,
} from './L1_spec/adr';
export {
  splitFrontmatter,
  parseFrontmatter,
  serializeFrontmatter,
} from './L1_spec/adr-frontmatter';
export type {
  FrontmatterField,
  ParsedFrontmatter,
} from './L1_spec/adr-frontmatter';

// L1 - Brainstorming Red Flags (T25 / superpowers pattern)
export {
  BRAINSTORMING_RED_FLAGS,
  getBrainstormingRedFlagByThought,
  topBrainstormingRedFlags,
} from './L1_spec/brainstorming-red-flags';
export type { RedFlag as BrainstormingRedFlag } from './L1_spec/brainstorming-red-flags';

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
// v13 — P3.2: AgentDB namespace conventions (comet pattern)
export {
  validateNamespace,
  parseAgentDBKey,
  formatKey,
  keyToFilePath,
  RESERVED_NAMESPACES,
  CANONICAL_NAMESPACES,
} from './L2_memory/namespace';
export type { NamespaceValidation, ParsedAgentDBKey } from './L2_memory/namespace';
export { makeKey, tryMakeKey } from './L2_memory/memory-keys';
// v13 — P4.1: STATUS.md live snapshot + task artifacts (Trellis pattern)
export {
  writeStatusSnapshot,
  readStatusSnapshot,
  buildStatusMarkdown,
} from './L2_memory/status-snapshot';
export type { StatusSnapshotInput } from './L2_memory/status-snapshot';
export {
  ensureTaskArtifacts,
  appendNote,
  recordRepairAttempt,
  readNotes,
  readRepairLog,
} from './L2_memory/task-artifacts';
export type { TaskContextInput } from './L2_memory/task-artifacts';
export {
  recordJournalEntry,
  getRecentJournals,
  generateSessionStartMessage,
} from './L2_memory/developer-journal';
export type { JournalEntry } from './L2_memory/developer-journal';
export { WorkspaceJournal } from './L2_memory/workspace-journal';
export type { JournalRecord } from './L2_memory/workspace-journal';
// v14 — P9.1: auto journal entry helper
export { autoAppendJournalEntry } from './L2_memory/workspace-journal';
export {
  ensureTaskBoard,
  syncTaskBoardPhase,
  appendProgress,
  appendFinding,
  isTaskPlanComplete,
  computePlanSha,
  readTaskBoardSummary,
} from './L2_memory/task-board';
export type { TaskBoardSnapshot, TaskBoardSummary } from './L2_memory/task-board';
export {
  createHNSWIndex,
  createNSWIndex,
  cosineSimilarity,
  euclideanDistance,
} from './L2_memory/hnsw-index';
export type { HNSWIndex, NSWIndex, HNSWOptions, NSWOptions, SearchResult } from './L2_memory/hnsw-index';
export {
  ensureStores,
  putStoreDoc,
  getStoreDoc,
  listStoreDocs,
  deleteStoreDoc,
  openVectorStore,
  reindexStores,
  embedText,
} from './L2_memory/stores';
export type { StoreKind, StoreDoc, StorePaths, VectorStore } from './L2_memory/stores';
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
// v13 — P6.1: Subagent 2-stage dispatch (superpowers pattern)
export {
  dispatchReview,
  runTwoStageReview,
  recordReviewInNotes,
} from './L3_roles/subagent-roles';
export type {
  SubagentRole,
  ReviewInput,
  ReviewResult,
  TwoStageReviewResult,
} from './L3_roles/subagent-roles';

// L4 - Discipline
export { StrikeSystem } from './L4_discipline/strike-system';
export type { StrikeReason, StrikeRecord } from './L4_discipline/strike-system';

// L4 - Discipline: TDD Iron Law + Failure Classifier (T32 / superpowers + ralphy pattern)
export {
  TDD_IRON_LAW_PHRASES,
  TDD_IRON_LAW_STOP_PHRASES,
  TDD_IRON_LAW_PHRASES_COMBINED,
  TDD_ESCAPE_HATCHES,
  checkTddIronLaw,
  // v13 — P1.2: hard-block TDD Iron Law check
  checkTddIronLawStrict,
} from './L4_discipline/tdd-iron-law';
export type { TddIronLawMatch } from './L4_discipline/tdd-iron-law';
export {
  classifyFailure,
  shouldStrike,
} from './L4_discipline/failure-classifier';
export type { FailureClass, FailureClassification } from './L4_discipline/failure-classifier';
// v13 — P6.2: Verification phrases (superpowers pattern)
export {
  checkVerificationPhrases,
  VERIFICATION_PHRASE_PATTERNS,
} from './L4_discipline/verification-phrases';
export type { VerificationPhraseResult } from './L4_discipline/verification-phrases';

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
export {
  runShellwardGuard,
  assertShellwardPreTool,
  SHELLWARD_LAYERS,
} from './L6_security/shellward-guard';
export type {
  ShellwardLayer,
  ShellwardFinding,
  ShellwardResult,
} from './L6_security/shellward-guard';

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
// v13 — P1.1: AutoLoopEngine exported for WorkerScheduler wiring
export { AutoLoopEngine } from './L7_loop/auto-loop-engine';
export type { AutoLoopEngineOptions, AutoLoopState } from './L7_loop/auto-loop-engine';
// v15 — P0-3: AutoLoopDriver exported for programmatic auto-loop execution
export { AutoLoopDriver } from './L7_loop/auto-loop-driver';
export type { AutoLoopDriverOptions, PrdReviewResult, StepInfo, StepResult, LoopCompleteResult, LoopDriverStatus } from './L7_loop/auto-loop-driver';
export { AutoLoopScheduler } from './L7_loop/auto-loop-scheduler';
export type { SchedulerStatus, SchedulerCallbacks, SchedulerState } from './L7_loop/auto-loop-scheduler';
// V20 Task 3: CLI daemon persistent state
export { loadDaemonState, saveDaemonState, createInitialDaemonState } from './L7_loop/daemon-state';
export type { DaemonState } from './L7_loop/daemon-state';
export { InnerStageResult } from './L7_loop/inner-loop';
export { PhaseOneResult, MakerResult } from './L7_loop/phase-loop';
export { StageGuards, createDefaultGuards, createPhaseGateAdapter } from './L7_loop/guards';
export type { GuardResult, GuardCheck } from './L7_loop/guards';
export { DeadlockDetector } from './L7_loop/deadlock-detector';
export type { ActionRecord, DeadlockDetectorConfig } from './L7_loop/deadlock-detector';
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
export { OuterLoop, defaultTriage, createDefaultStoryProvider, createDefaultHumanGate, createDefaultCommit } from './L7_loop/outer-loop';
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
// v14 — P8.5: Token cost tracker (ruflo pattern)
export { CostTracker } from './L7_loop/cost-tracker';
export type { CostTrackerOptions, ConsumeResult, BudgetUsage } from './L7_loop/cost-tracker';

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

// L7 - Stage-Tool Guard (CP-new-1: MCP dispatch interceptor)
export { checkStageTool, findStageForTool, getStageToolMatrix, WRITE_TOOLS } from './L7_loop/stage-tool-guard';
export type { StageToolGuardResult } from './L7_loop/stage-tool-guard';

// L7 - Recursion Guard (T13 / Trellis pattern)
export {
  withRecursionGuard,
  withRecursionGuardSync,
  getCurrentStack,
  RecursionGuardError,
  RECURSION_TOOLS,
} from './L7_loop/recursion-guard';

// L7 - Red Flags (T15 / comet pattern)
export {
  RED_FLAGS,
  RED_FLAGS_BY_TOOL,
  checkRedFlags,
  NOT_RECURSION,
} from './L7_loop/red-flags';
export type { RedFlag } from './L7_loop/red-flags';

// L7 - SPARC 5-Phase Gate (T26 / ruflo pattern)
export {
  SPARC_GATE_CRITERIA,
  SPARC_PHASE_ORDER,
  sparcPhaseForStage,
  nextSPARCPhase,
  evaluateSparcGate,
  evidenceFromMap,
  validateSparcConfig,
} from './L7_loop/sparc-gates';
export type {
  SPARCPhase,
  SPARCPhaseConfig,
  SPARCGateEvaluation,
  Evidence,
} from './L7_loop/sparc-gates';

// L7 - Completion Sentinel (T27 / ralphy-openspec pattern)
export {
  DEFAULT_SENTINELS,
  detectSentinel,
  detectAllSentinels,
  isTaskComplete,
} from './L7_loop/completion-sentinel';
export type { SentinelKey, SentinelMatch, SentinelAllMatch } from './L7_loop/completion-sentinel';

// L7 - Task Source Adapters (T27 / ralphy pattern)
export {
  TaskSourceAdapter,
  parseMdTasks,
  parseYamlTasks,
  parseJsonTasks,
  parseFolderTasks,
  parseGitHubTasks,
  parseRalphySpecTasks,
  parseOpenSpecChangeTasks,
  parseAzaPrdTasks,
} from './L7_loop/task-sources';
export type { TaskItem, GitHubIssueMock } from './L7_loop/task-sources';

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
  SwarmHostInstruction,
} from './L8_orchestrator/swarm/coordinator';
export { WorktreeManager } from './L8_orchestrator/worktree/manager';
export type {
  WorktreeConfig,
  WorktreeInfo,
  WorktreeCreateResult,
} from './L8_orchestrator/worktree/manager';
// v14 — P8.2: ANTI_DRIFT defaults + enforcer (ruflo pattern)
export {
  ANTI_DRIFT_DEFAULTS as L8_ANTI_DRIFT_DEFAULTS,
  enforceAntiDrift,
  loadAntiDriftDefaults,
  antiDriftPath,
  parseAntiDrift,
} from './L8_orchestrator/anti-drift';
export type { AntiDriftConfig as L8AntiDriftConfig, AntiDriftViolation } from './L8_orchestrator/anti-drift';
// v13 — P5.1: YAML orchestrator with SPARC integration (ralphy + ruflo)
export {
  YAMLOrchestrator,
  parseSimpleYaml,
  validatePipelineSchema,
} from './L8_orchestrator/yaml-orchestrator';
export type {
  OrchestrationStep,
  PipelineDefinition,
  PipelineStage,
  PipelineReport,
  StageReport,
  ValidationResult,
} from './L8_orchestrator/yaml-orchestrator';

// L8 - Swarm topology + consensus + ANTI_DRIFT (v13 P2.2 / ruflo pattern)
export {
  recommendTopology,
  evaluateConsensus,
  validateAntiDrift,
  TopologyAwareSwarmCoordinator,
  ANTI_DRIFT_DEFAULTS,
} from './L8_orchestrator/swarm/topology';
export type {
  Topology,
  Consensus,
  TopologyRecommendation,
  TeamCharacteristics,
  ConsensusVote,
  ConsensusResult,
  AntiDriftConfig,
} from './L8_orchestrator/swarm/topology';

// L9 - Knowledge
export { InjectionEngine } from './L9_knowledge/injection-engine';
export { breakLoop } from './L9_knowledge/break-loop';
export type { BreakLoopContext, BreakLoopResult, BreakLoopDimension, RootCause } from './L9_knowledge/break-loop';

// Quality
export { QualityPipeline, GATE6_NAME } from './quality/pipeline';
export type { GateResult, PipelineResult, GateExecutor } from './quality/pipeline';
export { lintGate } from './quality/gates/gate1-lint';
export { testGate } from './quality/gates/gate2-test';
export { regressionGate } from './quality/gates/gate3-regression';
export type { RegressionBaseline } from './quality/gates/gate3-regression';
export { securityGate } from './quality/gates/gate4-security';
export { acceptanceGate } from './quality/gates/gate5-acceptance';
export { adrComplianceGate, GATE7_NAME } from './quality/gates/gate7-adr-compliance';
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

// L0 - Platform: Plugin extension hooks (v14 — P8.6 / ruflo pattern)
export {
  validatePluginManifest,
  parsePluginManifest,
  registerPlugin,
  loadPlugin,
} from './L0_platform/plugin-loader';
export type {
  PluginManifest,
  PluginHandle,
  LoadPluginOptions,
  LoadPluginResult,
} from './L0_platform/plugin-loader';
export {
  WorkerScheduler,
  WorkerRegistry,
  DEFAULT_TRIGGERS,
  WORKER_NAMES,
  buildDefaultRegistry,
} from './L0_platform/workers';
export type {
  WorkerName,
  WorkerSchedule,
  WorkerTrigger,
  WorkerReport,
  WorkerFinding,
  WorkerFn,
  WorkerContext,
} from './L0_platform/workers';
export {
  runUltralearn,
  runOptimize,
  runConsolidate,
  runPredict,
  runAudit,
  runMap,
  runPreload,
  runDeepdive,
  runDocument,
  runRefactor,
  runBenchmark,
  runTestGaps,
} from './L0_platform/workers';

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
export { MCPEventBridge, StageWriteGuardError } from './Hook/mcp-event-bridge';
export type { ToolExecutor, BridgedResult, MCPEventBridgeOptions } from './Hook/mcp-event-bridge';
export { registerAllHookHandlers } from './Hook/handlers';

// Config
export { ConfigLoader } from './config/config-loader';
