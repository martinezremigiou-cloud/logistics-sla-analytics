// Re-exporta el ETL del Bloque 2 conservando el import path histórico.
export { runEtl, computeSnapshot, fuenteOf } from './etl/runEtl';
export { EtlContractError } from './etl/errors';
export { buildIngestPayload } from './etl/persist';
export type { EtlDeps, ComputeResult } from './etl/runEtl';
export type {
  IngestJob,
  EtlResult,
  SnapshotPayload,
  CatalogIndex,
  PrevState,
  QuarantineItem,
  DiagItem,
} from './etl/types';
