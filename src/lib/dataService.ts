import type {
  ResidenceRecord,
  RecordStatus,
  DuplicateCluster,
  AnalyticsSummary,
  UploadBatch,
  BackupEntry,
  SystemLogEntry,
  AppNotification,
  ServerMetricsSnapshot,
  MonthlyServerReport,
} from '../types';
import {
  parseWorkbookArrayBuffer,
  generateOfficialExcelClientBlob,
  computeDuplicatesClient,
  computeAnalyticsClient,
  triggerBlobDownload,
  normalizeCodeClient,
  normalizeTextClient,
} from './clientExcel';
import {
  idbGet,
  idbSet,
  enqueueOutboxOp,
  mirrorSnapshotToIdb,
  loadMirrorFromIdb,
  getOutboxOps,
  syncPendingOutbox,
} from './offlineStore';

export interface FullAppSnapshot {
  records: ResidenceRecord[];
  duplicateClusters: DuplicateCluster[];
  analytics: AnalyticsSummary;
  uploads: UploadBatch[];
  backups: BackupEntry[];
  logs: SystemLogEntry[];
  notifications: AppNotification[];
  metrics: ServerMetricsSnapshot | null;
  monthlyReports: MonthlyServerReport[];
  fromOfflineCache: boolean;
  pendingSyncCount: number;
}

function getNextTempId(records: ResidenceRecord[]): number {
  const minId = records.reduce((acc, r) => Math.min(acc, r.id), 0);
  return minId <= 0 ? minId - 1 : -1;
}

async function appendLocalLogAndNotification(
  level: 'INFO' | 'WARN',
  category: SystemLogEntry['category'],
  message: string,
  notif?: Omit<AppNotification, 'id' | 'timestamp' | 'is_read'>
): Promise<void> {
  const now = new Date().toISOString();
  const logs = (await idbGet<SystemLogEntry[]>('logs')) || [];
  logs.unshift({
    id: -Date.now(),
    timestamp: now,
    level,
    category,
    message,
    details: JSON.stringify({ offline: true }),
  });
  await idbSet('logs', logs.slice(0, 200));

  if (notif) {
    const notifs = (await idbGet<AppNotification[]>('notifications')) || [];
    notifs.unshift({
      id: -Date.now(),
      timestamp: now,
      is_read: 0,
      ...notif,
    });
    await idbSet('notifications', notifs.slice(0, 60));
  }
}

let cachedBackendStatus: boolean | null = null;
let lastProbeTs = 0;

export async function isBackendAvailable(force = false): Promise<boolean> {
  if (!navigator.onLine) return false;
  const now = Date.now();
  if (!force && cachedBackendStatus !== null && now - lastProbeTs < 30_000) {
    return cachedBackendStatus;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  try {
    const resp = await fetch('/api/health', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const ct = resp.headers.get('content-type') || '';
    if (!resp.ok || !ct.includes('application/json')) {
      cachedBackendStatus = false;
      lastProbeTs = now;
      return false;
    }
    const json = (await resp.json().catch(() => null)) as { status?: string } | null;
    cachedBackendStatus = Boolean(json && json.status === 'ok');
    lastProbeTs = now;
    return cachedBackendStatus;
  } catch {
    cachedBackendStatus = false;
    lastProbeTs = now;
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAppSnapshot(): Promise<FullAppSnapshot> {
  const pendingOps = await getOutboxOps();
  const hasBackend = await isBackendAvailable();

  if (hasBackend) {
    try {
      const [recRes, anaRes, upRes, bakRes, logRes, notifRes, metRes, repRes] =
        await Promise.all([
          fetch('/api/records').then((r) => {
            if (!r.ok) throw new Error('offline');
            return r.json();
          }),
          fetch('/api/analytics').then((r) => r.json()),
          fetch('/api/uploads').then((r) => r.json()),
          fetch('/api/backups').then((r) => r.json()),
          fetch('/api/logs').then((r) => r.json()),
          fetch('/api/notifications').then((r) => r.json()),
          fetch('/api/metrics').then((r) => r.json()),
          fetch('/api/reports/monthly').then((r) => r.json()),
        ]);

      const snapshot: FullAppSnapshot = {
        records: recRes.records || [],
        duplicateClusters: recRes.duplicateClusters || [],
        analytics: anaRes,
        uploads: upRes.uploads || [],
        backups: bakRes.backups || [],
        logs: logRes.logs || [],
        notifications: notifRes.notifications || [],
        metrics: metRes || null,
        monthlyReports: repRes.reports || [],
        fromOfflineCache: false,
        pendingSyncCount: pendingOps.length,
      };

      await mirrorSnapshotToIdb({
        records: snapshot.records,
        uploads: snapshot.uploads,
        backups: snapshot.backups,
        logs: snapshot.logs,
        notifications: snapshot.notifications,
        monthlyReports: snapshot.monthlyReports,
      });

      return snapshot;
    } catch {
      cachedBackendStatus = false;
    }
  }

  const cached = await loadMirrorFromIdb();
  const { annotated, clusters } = computeDuplicatesClient(cached.records);
  const analytics = computeAnalyticsClient(annotated, clusters.length);

  return {
    records: annotated,
    duplicateClusters: clusters,
    analytics,
    uploads: cached.uploads,
    backups: cached.backups,
    logs: cached.logs,
    notifications: cached.notifications,
    metrics: null,
    monthlyReports: cached.monthlyReports,
    fromOfflineCache: true,
    pendingSyncCount: pendingOps.length,
  };
}

export async function updateRecordStatusOrFields(
  id: number,
  body: Partial<ResidenceRecord>
): Promise<void> {
  if (await isBackendAvailable()) {
    try {
      const resp = await fetch(`/api/records/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) return;
    } catch {
      // Offline fallback below
    }
  }

  const records = (await idbGet<ResidenceRecord[]>('records')) || [];
  const now = new Date().toISOString();
  const updated = records.map((r) =>
    r.id === id ? { ...r, ...body, updated_at: now } : r
  );
  await idbSet('records', updated);
  await enqueueOutboxOp({ type: 'update_record', payload: { id, body } });
  await appendLocalLogAndNotification(
    'INFO',
    'STATUS',
    `Registro #${id} actualizado en modo offline`
  );
}

export async function createRecordEntry(body: Partial<ResidenceRecord>): Promise<void> {
  if (await isBackendAvailable()) {
    try {
      const resp = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) return;
    } catch {
      // Offline fallback below
    }
  }

  const records = (await idbGet<ResidenceRecord[]>('records')) || [];
  const now = new Date().toISOString();
  const newRec: ResidenceRecord = {
    id: getNextTempId(records),
    row_number: records.length + 1,
    documento: String(body.documento || ''),
    codigo_nro: String(body.codigo_nro || ''),
    nombres: String(body.nombres || ''),
    apellidos: String(body.apellidos || ''),
    fecha_nacimiento: String(body.fecha_nacimiento || ''),
    barrio_residencia: String(body.barrio_residencia || ''),
    servicio_figura: String(body.servicio_figura || ''),
    servicio_corresponde: String(body.servicio_corresponde || ''),
    distrito: String(body.distrito || ''),
    servicio_planilla: String(body.servicio_planilla || ''),
    responsable: String(body.responsable || ''),
    status: (body.status as RecordStatus) || 'pendiente',
    month_key:
      body.month_key ||
      `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    source_file: 'Ingreso Manual (Offline)',
    notes: String(body.notes || ''),
    created_at: now,
    updated_at: now,
  };
  records.unshift(newRec);
  await idbSet('records', records);
  await enqueueOutboxOp({ type: 'create_record', payload: body as Record<string, unknown> });
  await appendLocalLogAndNotification(
    'INFO',
    'IMPORT',
    `Registro "${newRec.nombres} ${newRec.apellidos}" guardado localmente (offline)`
  );
}

export async function bulkUpdateStatus(ids: number[], status: RecordStatus): Promise<void> {
  if (await isBackendAvailable()) {
    try {
      const resp = await fetch('/api/records/bulk-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, status }),
      });
      if (resp.ok) return;
    } catch {
      // Offline fallback
    }
  }

  const records = (await idbGet<ResidenceRecord[]>('records')) || [];
  const idSet = new Set(ids);
  const now = new Date().toISOString();
  const updated = records.map((r) =>
    idSet.has(r.id) ? { ...r, status, updated_at: now } : r
  );
  await idbSet('records', updated);
  await enqueueOutboxOp({ type: 'bulk_status', payload: { ids, status } });
  await appendLocalLogAndNotification(
    'INFO',
    'STATUS',
    `Actualización masiva offline: ${ids.length} registro(s) -> ${status}`
  );
}

export async function deleteRecordEntry(id: number): Promise<void> {
  if (await isBackendAvailable()) {
    try {
      const resp = await fetch(`/api/records/${id}`, { method: 'DELETE' });
      if (resp.ok) return;
    } catch {
      // Offline fallback
    }
  }

  const records = (await idbGet<ResidenceRecord[]>('records')) || [];
  await idbSet(
    'records',
    records.filter((r) => r.id !== id)
  );
  await enqueueOutboxOp({ type: 'delete_record', payload: { id } });
  await appendLocalLogAndNotification('INFO', 'DEDUP', `Registro #${id} eliminado (offline)`);
}

export async function resolveDuplicatesBatch(keep: 'earliest' | 'latest'): Promise<void> {
  if (await isBackendAvailable()) {
    try {
      const resp = await fetch('/api/duplicates/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep }),
      });
      if (resp.ok) return;
    } catch {
      // Offline fallback
    }
  }

  const records = (await idbGet<ResidenceRecord[]>('records')) || [];
  const { clusters } = computeDuplicatesClient(records);
  const toDelete = new Set<number>();
  for (const cluster of clusters) {
    const sorted = [...cluster.records].sort((a, b) => a.id - b.id);
    const keepItem = keep === 'latest' ? sorted[sorted.length - 1] : sorted[0];
    for (const r of sorted) {
      if (r.id !== keepItem.id) toDelete.add(r.id);
    }
  }
  await idbSet(
    'records',
    records.filter((r) => !toDelete.has(r.id))
  );
  await enqueueOutboxOp({ type: 'resolve_duplicates', payload: { keep } });
  await appendLocalLogAndNotification(
    'INFO',
    'DEDUP',
    `Depuración offline: ${toDelete.size} duplicados eliminados`
  );
}

export async function previewExcelFile(file: File): Promise<{
  base64: string;
  distrito: string;
  servicio: string;
  responsable: string;
  totalRows: number;
  potentialDuplicates: number;
  rows: Array<{
    row_number: number;
    documento: string;
    codigo_nro: string;
    nombres: string;
    apellidos: string;
    fecha_nacimiento: string;
    barrio_residencia: string;
    servicio_figura: string;
    servicio_corresponde: string;
    potentialDuplicate?: boolean;
  }>;
}> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });

  if (await isBackendAvailable()) {
    try {
      const resp = await fetch('/api/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, base64 }),
      });
      if (resp.ok) {
        const data = await resp.json();
        return { base64, ...data };
      }
    } catch {
      // Fallback to local parser below
    }
  }

  const arrayBuffer = await file.arrayBuffer();
  const parsed = parseWorkbookArrayBuffer(arrayBuffer);
  const existing = (await idbGet<ResidenceRecord[]>('records')) || [];
  const docSet = new Set(existing.map((e) => normalizeCodeClient(e.documento)).filter((x) => x.length >= 4));
  const codSet = new Set(existing.map((e) => normalizeCodeClient(e.codigo_nro)).filter((x) => x.length >= 3));
  const idSet = new Set(
    existing
      .filter((e) => e.nombres && e.apellidos && e.fecha_nacimiento)
      .map(
        (e) =>
          `${normalizeTextClient(e.nombres)}|${normalizeTextClient(e.apellidos)}|${normalizeTextClient(
            e.fecha_nacimiento
          )}`
      )
  );

  let potentialDuplicates = 0;
  const seenDocs = new Set<string>();
  const seenCodes = new Set<string>();
  const rows = parsed.rows.map((r) => {
    const dNorm = normalizeCodeClient(r.documento);
    const cNorm = normalizeCodeClient(r.codigo_nro);
    const iNorm =
      r.nombres && r.apellidos && r.fecha_nacimiento
        ? `${normalizeTextClient(r.nombres)}|${normalizeTextClient(r.apellidos)}|${normalizeTextClient(
            r.fecha_nacimiento
          )}`
        : '';
    const dup =
      (dNorm.length >= 4 && (docSet.has(dNorm) || seenDocs.has(dNorm))) ||
      (cNorm.length >= 3 && (codSet.has(cNorm) || seenCodes.has(cNorm))) ||
      (iNorm !== '' && idSet.has(iNorm));
    if (dNorm.length >= 4) seenDocs.add(dNorm);
    if (cNorm.length >= 3) seenCodes.add(cNorm);
    if (dup) potentialDuplicates++;
    return { ...r, potentialDuplicate: dup };
  });

  return {
    base64,
    distrito: parsed.distrito,
    servicio: parsed.servicio,
    responsable: parsed.responsable,
    totalRows: rows.length,
    potentialDuplicates,
    rows,
  };
}

export async function importExcelData(params: {
  filename: string;
  base64: string;
  monthKey: string;
  distritoOverride: string;
  servicioOverride: string;
  responsableOverride: string;
  parsedRows?: Array<{
    row_number: number;
    documento: string;
    codigo_nro: string;
    nombres: string;
    apellidos: string;
    fecha_nacimiento: string;
    barrio_residencia: string;
    servicio_figura: string;
    servicio_corresponde: string;
  }>;
}): Promise<{ imported: number; duplicatesDetected: number }> {
  if (await isBackendAvailable()) {
    try {
      const resp = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: params.filename,
          base64: params.base64,
          monthKey: params.monthKey,
          distritoOverride: params.distritoOverride,
          servicioOverride: params.servicioOverride,
          responsableOverride: params.responsableOverride,
        }),
      });
      if (resp.ok) {
        return await resp.json();
      }
      const errData = await resp.json().catch(() => ({}));
      if (resp.status >= 400 && resp.status < 500) {
        throw new Error(errData.error || 'Error al importar');
      }
    } catch (err) {
      if (err instanceof Error && err.message !== 'Failed to fetch') {
        // Only fall back on network errors
      }
    }
  }

  // Offline local import into IndexedDB
  const rows = params.parsedRows || [];
  const existing = (await idbGet<ResidenceRecord[]>('records')) || [];
  let nextId = getNextTempId(existing);
  const now = new Date().toISOString();

  const newRecords: ResidenceRecord[] = rows.map((r) => ({
    id: nextId--,
    row_number: r.row_number,
    documento: r.documento,
    codigo_nro: r.codigo_nro,
    nombres: r.nombres,
    apellidos: r.apellidos,
    fecha_nacimiento: r.fecha_nacimiento,
    barrio_residencia: r.barrio_residencia,
    servicio_figura: r.servicio_figura,
    servicio_corresponde: r.servicio_corresponde,
    distrito: params.distritoOverride,
    servicio_planilla: params.servicioOverride,
    responsable: params.responsableOverride,
    status: 'pendiente',
    month_key: params.monthKey,
    source_file: params.filename,
    notes: '',
    created_at: now,
    updated_at: now,
  }));

  const combined = [...newRecords, ...existing];
  const { annotated, clusters } = computeDuplicatesClient(combined);
  const newIds = new Set(newRecords.map((r) => r.id));
  const duplicatesInBatch = annotated.filter((r) => newIds.has(r.id) && r.is_duplicate).length;

  await idbSet('records', combined);

  const uploads = (await idbGet<UploadBatch[]>('uploads')) || [];
  uploads.unshift({
    id: -Date.now(),
    filename: params.filename,
    distrito: params.distritoOverride,
    servicio: params.servicioOverride,
    responsable: params.responsableOverride,
    total_rows: newRecords.length,
    duplicates_detected: duplicatesInBatch,
    uploaded_at: now,
  });
  await idbSet('uploads', uploads.slice(0, 50));

  await enqueueOutboxOp({
    type: 'import_excel',
    payload: {
      filename: params.filename,
      base64: params.base64,
      monthKey: params.monthKey,
      distritoOverride: params.distritoOverride,
      servicioOverride: params.servicioOverride,
      responsableOverride: params.responsableOverride,
    },
  });

  await appendLocalLogAndNotification(
    duplicatesInBatch > 0 ? 'WARN' : 'INFO',
    duplicatesInBatch > 0 ? 'DEDUP' : 'IMPORT',
    `Planilla "${params.filename}" cargada en modo offline (${newRecords.length} filas, ${duplicatesInBatch} duplicados)`,
    duplicatesInBatch > 0
      ? {
          type: 'duplicate_alert',
          title: `Alerta offline: ${duplicatesInBatch} duplicado(s) detectado(s)`,
          message: `La carga local de "${params.filename}" detectó ${duplicatesInBatch} coincidencia(s) en ${clusters.length} grupo(s).`,
          metadata: '{}',
        }
      : {
          type: 'import_success',
          title: 'Planilla cargada localmente (Offline)',
          message: `Se guardaron ${newRecords.length} registros en el dispositivo.`,
          metadata: '{}',
        }
  );

  return { imported: newRecords.length, duplicatesDetected: duplicatesInBatch };
}

export async function markRecordsDispatched(
  ids: number[],
  dispatchedAt: string | null
): Promise<void> {
  if (ids.length === 0) return;

  if (await isBackendAvailable()) {
    try {
      const resp = await fetch('/api/records/mark-dispatched', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, dispatchedAt }),
      });
      if (resp.ok) {
        const records = (await idbGet<ResidenceRecord[]>('records')) || [];
        const idSet = new Set(ids);
        const val = dispatchedAt ?? '';
        await idbSet(
          'records',
          records.map((r) => (idSet.has(r.id) ? { ...r, dispatched_at: val } : r))
        );
        return;
      }
    } catch {
      // Offline fallback below
    }
  }

  const records = (await idbGet<ResidenceRecord[]>('records')) || [];
  const idSet = new Set(ids);
  const val = dispatchedAt ?? '';
  const now = new Date().toISOString();
  await idbSet(
    'records',
    records.map((r) =>
      idSet.has(r.id) ? { ...r, dispatched_at: val, updated_at: now } : r
    )
  );
  await enqueueOutboxOp({
    type: 'mark_dispatched',
    payload: { ids, dispatchedAt },
  });
  await appendLocalLogAndNotification(
    'INFO',
    'EXPORT',
    val
      ? `${ids.length} registro(s) marcado(s) como remitido(s) en modo offline`
      : `${ids.length} registro(s) reabierto(s) para remisión en modo offline`
  );
}

export async function downloadOfficialExcel(params: {
  records: ResidenceRecord[];
  statusFilter: string;
  monthFilter: string;
  distritoFilter?: string;
  servicioFilter?: string;
  dateFrom?: string;
  dateTo?: string;
  distrito?: string;
  servicio?: string;
  responsable?: string;
  template?: boolean;
  includeDispatched?: boolean;
}): Promise<{ exportedCount: number; skippedDispatched: number }> {
  let scoped = params.records;
  let skippedDispatched = 0;

  if (params.template) {
    scoped = [];
  } else {
    if (params.statusFilter !== 'all') {
      scoped = scoped.filter((r) => r.status === params.statusFilter);
    }
    if (params.monthFilter !== 'all') {
      scoped = scoped.filter((r) => r.month_key === params.monthFilter);
    }
    if (params.distritoFilter && params.distritoFilter !== 'all') {
      scoped = scoped.filter((r) => r.distrito === params.distritoFilter);
    }
    if (params.servicioFilter && params.servicioFilter !== 'all') {
      scoped = scoped.filter((r) => r.servicio_planilla === params.servicioFilter);
    }
    if (params.dateFrom) {
      scoped = scoped.filter((r) => (r.created_at || '').slice(0, 10) >= params.dateFrom!);
    }
    if (params.dateTo) {
      scoped = scoped.filter((r) => (r.created_at || '').slice(0, 10) <= params.dateTo!);
    }
    if (params.statusFilter === 'otro_departamento' && !params.includeDispatched) {
      const before = scoped.length;
      scoped = scoped.filter((r) => !r.dispatched_at);
      skippedDispatched = before - scoped.length;
    }
  }

  if (!params.template && params.statusFilter === 'otro_departamento' && scoped.length === 0) {
    return { exportedCount: 0, skippedDispatched };
  }

  const effectiveDistrito =
    params.distrito ||
    (params.distritoFilter && params.distritoFilter !== 'all' ? params.distritoFilter : undefined);
  const effectiveServicio =
    params.servicio ||
    (params.servicioFilter && params.servicioFilter !== 'all' ? params.servicioFilter : undefined);

  const blob = await generateOfficialExcelClientBlob({
    records: scoped,
    distrito: effectiveDistrito,
    servicio: effectiveServicio,
    responsable: params.responsable,
    minRows: 25,
  });

  const labelPart = params.template
    ? 'PLANTILLA'
    : params.statusFilter === 'otro_departamento'
    ? 'OTRO_DEPARTAMENTO'
    : params.statusFilter.toUpperCase();
  const svc = (effectiveServicio || scoped[0]?.servicio_planilla || labelPart).replace(
    /[^a-zA-Z0-9_\-]/g,
    '_'
  );
  triggerBlobDownload(blob, `CAMBIO_DE_RESIDENCIA_-_${svc}.xlsx`);

  if (!params.template && params.statusFilter === 'otro_departamento' && scoped.length > 0) {
    const now = new Date().toISOString();
    const toMark = scoped.filter((r) => !r.dispatched_at).map((r) => r.id);
    if (toMark.length > 0) {
      await markRecordsDispatched(toMark, now);
    }
  }

  return { exportedCount: scoped.length, skippedDispatched };
}

export async function downloadLocalBackupJson(records: ResidenceRecord[]): Promise<void> {
  const uploads = (await idbGet<UploadBatch[]>('uploads')) || [];
  const now = new Date().toISOString();
  const payload = JSON.stringify(
    {
      schemaVersion: 1,
      app: 'ResiControl',
      exportedAt: now,
      label: 'Respaldo local completo',
      records,
      uploads,
    },
    null,
    2
  );
  const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
  triggerBlobDownload(blob, `resicontrol_backup_${now.slice(0, 10)}.json`);
}

export async function loadDemoRecords(): Promise<void> {
  if (await isBackendAvailable()) {
    try {
      const resp = await fetch('/api/demo-load', { method: 'POST' });
      if (resp.ok) return;
    } catch {
      // Fall back to local demo records
    }
  }

  const now = new Date().toISOString();
  const mk = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const sampleRows: Omit<ResidenceRecord, 'id'>[] = [
    {
      row_number: 1,
      documento: '8123456',
      codigo_nro: 'COD-101',
      nombres: 'Mateo Sebastián',
      apellidos: 'Benítez Rojas',
      fecha_nacimiento: '14/05/2023',
      barrio_residencia: 'San Vicente',
      servicio_figura: 'USF Centro',
      servicio_corresponde: 'USF San Vicente',
      distrito: 'Distrito Capital',
      servicio_planilla: 'USF Centro',
      responsable: 'Lic. Carmen Duarte',
      status: 'realizado',
      month_key: mk,
      source_file: 'Planilla_Ejemplo_Demo.xlsx',
      notes: '',
      created_at: now,
      updated_at: now,
    },
    {
      row_number: 2,
      documento: '8234567',
      codigo_nro: 'COD-102',
      nombres: 'Sofía Valentina',
      apellidos: 'Gómez Vera',
      fecha_nacimiento: '22/08/2022',
      barrio_residencia: 'Santa Ana',
      servicio_figura: 'USF Centro',
      servicio_corresponde: 'Hospital Distrital',
      distrito: 'Distrito Capital',
      servicio_planilla: 'USF Centro',
      responsable: 'Lic. Carmen Duarte',
      status: 'pendiente',
      month_key: mk,
      source_file: 'Planilla_Ejemplo_Demo.xlsx',
      notes: '',
      created_at: now,
      updated_at: now,
    },
    {
      row_number: 3,
      documento: '8345678',
      codigo_nro: 'COD-103',
      nombres: 'Lucas Gabriel',
      apellidos: 'Acosta López',
      fecha_nacimiento: '03/11/2021',
      barrio_residencia: 'Villa Aurelia',
      servicio_figura: 'USF Centro',
      servicio_corresponde: 'USF Limpio Norte (Otro Dpto.)',
      distrito: 'Distrito Capital',
      servicio_planilla: 'USF Centro',
      responsable: 'Lic. Carmen Duarte',
      status: 'otro_departamento',
      month_key: mk,
      source_file: 'Planilla_Ejemplo_Demo.xlsx',
      notes: '',
      created_at: now,
      updated_at: now,
    },
  ];

  const existing = (await idbGet<ResidenceRecord[]>('records')) || [];
  let nextId = getNextTempId(existing);
  const created = sampleRows.map((row) => ({ ...row, id: nextId-- }));
  await idbSet('records', [...created, ...existing]);

  const uploads = (await idbGet<UploadBatch[]>('uploads')) || [];
  uploads.unshift({
    id: -Date.now(),
    filename: 'Planilla_Ejemplo_Demo.xlsx',
    distrito: 'Distrito Capital',
    servicio: 'USF Centro',
    responsable: 'Lic. Carmen Duarte',
    total_rows: created.length,
    duplicates_detected: 0,
    uploaded_at: now,
  });
  await idbSet('uploads', uploads.slice(0, 50));
}

export async function restoreBackupData(
  mode: 'merge' | 'replace',
  data: { records?: ResidenceRecord[]; uploads?: UploadBatch[] }
): Promise<{ restored: number; viaServer: boolean }> {
  if (await isBackendAvailable()) {
    try {
      const resp = await fetch('/api/backups/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, data }),
      });
      if (resp.ok) {
        const resJson = await resp.json();
        return { restored: Number(resJson.restored || 0), viaServer: true };
      }
      const errJson = await resp.json().catch(() => ({}));
      throw new Error(errJson.error || 'No se pudo restaurar el respaldo');
    } catch (err) {
      if (err instanceof Error && err.message !== 'Failed to fetch') {
        throw err;
      }
    }
  }

  const incoming = Array.isArray(data.records) ? data.records : [];
  if (mode === 'replace') {
    await idbSet('records', incoming);
    if (Array.isArray(data.uploads)) {
      await idbSet('uploads', data.uploads);
    }
    return { restored: incoming.length, viaServer: false };
  }

  const existing = (await idbGet<ResidenceRecord[]>('records')) || [];
  let nextId = getNextTempId(existing);
  const mapped = incoming.map((r) => ({
    ...r,
    id: r.id && !existing.some((e) => e.id === r.id) ? r.id : nextId--,
  }));
  await idbSet('records', [...mapped, ...existing]);
  return { restored: mapped.length, viaServer: false };
}

export { syncPendingOutbox };
