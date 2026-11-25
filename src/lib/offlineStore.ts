import type {
  ResidenceRecord,
  UploadBatch,
  BackupEntry,
  SystemLogEntry,
  AppNotification,
  MonthlyServerReport,
  RecordStatus,
} from '../types';

const DB_NAME = 'resicontrol_offline_v1';
const DB_VERSION = 1;
const STORE_KV = 'kv';
const STORE_OUTBOX = 'outbox';

export interface OutboxOp {
  opId?: number;
  createdAt: string;
  type:
    | 'create_record'
    | 'update_record'
    | 'bulk_status'
    | 'delete_record'
    | 'resolve_duplicates'
    | 'import_excel'
    | 'mark_dispatched';
  payload: Record<string, unknown>;
}

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: 'opId', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_KV, 'readonly');
      const req = tx.objectStore(STORE_KV).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_KV, 'readwrite');
      tx.objectStore(STORE_KV).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore IDB quota errors gracefully
  }
}

export async function enqueueOutboxOp(op: Omit<OutboxOp, 'opId' | 'createdAt'>): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    tx.objectStore(STORE_OUTBOX).add({
      ...op,
      createdAt: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOutboxOps(): Promise<OutboxOp[]> {
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOX, 'readonly');
      const req = tx.objectStore(STORE_OUTBOX).getAll();
      req.onsuccess = () => resolve((req.result as OutboxOp[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function clearOutboxOp(opId: number): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    tx.objectStore(STORE_OUTBOX).delete(opId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface OfflineMirrorPayload {
  records: ResidenceRecord[];
  uploads: UploadBatch[];
  backups: BackupEntry[];
  logs: SystemLogEntry[];
  notifications: AppNotification[];
  monthlyReports: MonthlyServerReport[];
}

export async function mirrorSnapshotToIdb(data: Partial<OfflineMirrorPayload>): Promise<void> {
  const jobs: Promise<void>[] = [];
  if (data.records) jobs.push(idbSet('records', data.records));
  if (data.uploads) jobs.push(idbSet('uploads', data.uploads));
  if (data.backups) jobs.push(idbSet('backups', data.backups));
  if (data.logs) jobs.push(idbSet('logs', data.logs));
  if (data.notifications) jobs.push(idbSet('notifications', data.notifications));
  if (data.monthlyReports) jobs.push(idbSet('monthlyReports', data.monthlyReports));
  await Promise.all(jobs);
}

export async function loadMirrorFromIdb(): Promise<OfflineMirrorPayload> {
  const [records, uploads, backups, logs, notifications, monthlyReports] = await Promise.all([
    idbGet<ResidenceRecord[]>('records'),
    idbGet<UploadBatch[]>('uploads'),
    idbGet<BackupEntry[]>('backups'),
    idbGet<SystemLogEntry[]>('logs'),
    idbGet<AppNotification[]>('notifications'),
    idbGet<MonthlyServerReport[]>('monthlyReports'),
  ]);
  return {
    records: records || [],
    uploads: uploads || [],
    backups: backups || [],
    logs: logs || [],
    notifications: notifications || [],
    monthlyReports: monthlyReports || [],
  };
}

export async function syncPendingOutbox(): Promise<number> {
  const ops = await getOutboxOps();
  if (ops.length === 0) return 0;

  let synced = 0;
  for (const op of ops) {
    try {
      let ok = false;
      if (op.type === 'import_excel') {
        const resp = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(op.payload),
        });
        ok = resp.ok;
      } else if (op.type === 'create_record') {
        const resp = await fetch('/api/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(op.payload),
        });
        ok = resp.ok;
      } else if (op.type === 'update_record') {
        const id = Number(op.payload.id);
        if (id > 0) {
          const resp = await fetch(`/api/records/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(op.payload.body),
          });
          ok = resp.ok || resp.status === 404;
        } else {
          // Record created offline with negative temp ID: create on server
          const resp = await fetch('/api/records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(op.payload.body),
          });
          ok = resp.ok;
        }
      } else if (op.type === 'bulk_status') {
        const ids = ((op.payload.ids as number[]) || []).filter((x) => x > 0);
        if (ids.length === 0) {
          ok = true;
        } else {
          const resp = await fetch('/api/records/bulk-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, status: op.payload.status as RecordStatus }),
          });
          ok = resp.ok;
        }
      } else if (op.type === 'delete_record') {
        const id = Number(op.payload.id);
        if (id > 0) {
          const resp = await fetch(`/api/records/${id}`, { method: 'DELETE' });
          ok = resp.ok || resp.status === 404;
        } else {
          ok = true;
        }
      } else if (op.type === 'resolve_duplicates') {
        const resp = await fetch('/api/duplicates/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(op.payload),
        });
        ok = resp.ok;
      } else if (op.type === 'mark_dispatched') {
        const ids = ((op.payload.ids as number[]) || []).filter((x) => x > 0);
        if (ids.length === 0) {
          ok = true;
        } else {
          const resp = await fetch('/api/records/mark-dispatched', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ids,
              dispatchedAt: op.payload.dispatchedAt ?? null,
            }),
          });
          ok = resp.ok;
        }
      }

      if (ok && op.opId !== undefined) {
        await clearOutboxOp(op.opId);
        synced++;
      }
    } catch {
      // Stop on network failure and retry on next reconnect
      break;
    }
  }
  return synced;
}
