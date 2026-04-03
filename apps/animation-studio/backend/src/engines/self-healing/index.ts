export {
  classifyFailure, attemptRecovery, saveCheckpoint, getLatestCheckpoint, clearCheckpoints,
  registerHeartbeat, detectStaleWorkers, reclaimWorkerJob,
  getCircuit, recordCircuitFailure, recordCircuitSuccess, isCircuitOpen,
  checkMemoryPressure, getStageBudget, quarantineJob, isJobQuarantined,
  reportQueueHealth, reportIncident, getRecentIncidents, getHealthMetrics,
  type ClassifiedFailure, type FailureClass, type Checkpoint, type QueueHealthReport,
  type IncidentReport, type RecoveryResult, type EscalationLevel,
  revalidateAssets, canAutoFixQC, getEscalationLevel,
} from './selfHealingLayer';
