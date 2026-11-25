export type RecordStatus = 'pendiente' | 'realizado' | 'otro_departamento';

export interface ResidenceRecord {
  id: number;
  row_number: number;
  documento: string;
  codigo_nro: string;
  nombres: string;
  apellidos: string;
  fecha_nacimiento: string;
  barrio_residencia: string;
  servicio_figura: string;
  servicio_corresponde: string;
  distrito: string;
  servicio_planilla: string;
  responsable: string;
  status: RecordStatus;
  month_key: string;
  source_file: string;
  notes: string;
  created_at: string;
  updated_at: string;
  is_duplicate?: boolean;
  duplicate_reasons?: string[];
}

export interface DuplicateCluster {
  clusterId: string;
  matchKey: string;
  reasons: string[];
  records: ResidenceRecord[];
}

export interface MonthlyMetricPoint {
  month_key: string;
  label: string;
  total: number;
  realizado: number;
  pendiente: number;
  otro_departamento: number;
  completionRate: number;
}

export interface ServiceBreakdownPoint {
  servicio: string;
  total: number;
  realizado: number;
  pendiente: number;
  otro_departamento: number;
}

export interface AnalyticsSummary {
  totals: {
    total: number;
    realizado: number;
    pendiente: number;
    otro_departamento: number;
    completionRate: number;
    duplicateRecords: number;
    duplicateClusters: number;
  };
  monthly: MonthlyMetricPoint[];
  byService: ServiceBreakdownPoint[];
  byDistrict: Array<{ distrito: string; total: number; otro_departamento: number }>;
  availableMonths: string[];
}

export interface SystemLogEntry {
  id: number;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  category: 'IMPORT' | 'DEDUP' | 'STATUS' | 'EXPORT' | 'BACKUP' | 'SYSTEM' | 'SECURITY';
  message: string;
  details: string;
}

export interface AppNotification {
  id: number;
  timestamp: string;
  type: 'duplicate_alert' | 'import_success' | 'export_ready' | 'backup_created' | 'system_alert';
  title: string;
  message: string;
  is_read: number;
  metadata: string;
}

export interface BackupEntry {
  id: number;
  created_at: string;
  label: string;
  record_count: number;
  size_bytes: number;
}

export interface UploadBatch {
  id: number;
  filename: string;
  distrito: string;
  servicio: string;
  responsable: string;
  total_rows: number;
  duplicates_detected: number;
  uploaded_at: string;
}

export interface ServerMetricsSnapshot {
  timestamp: string;
  uptimeSeconds: number;
  cpuCores: number;
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  memoryRssMb: number;
  memoryHeapUsedMb: number;
  memoryHeapTotalMb: number;
  systemTotalMemMb: number;
  systemFreeMemMb: number;
  dbSizeKb: number;
  activeSseClients: number;
  avgLatencyMs: number;
  requestsLastMinute: number;
  errorRatePercent: number;
}

export interface MonthlyServerReport {
  month_key: string;
  label: string;
  total_requests: number;
  error_requests: number;
  availability_percent: number;
  avg_latency_ms: number;
  max_latency_ms: number;
  peak_memory_mb: number;
  records_processed: number;
  exports_generated: number;
  backups_created: number;
  last_updated: string;
}
