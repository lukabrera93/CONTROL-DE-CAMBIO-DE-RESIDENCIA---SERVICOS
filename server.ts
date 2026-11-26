import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import type {
  ResidenceRecord,
  RecordStatus,
  DuplicateCluster,
  AnalyticsSummary,
  MonthlyMetricPoint,
  ServiceBreakdownPoint,
  ServerMetricsSnapshot,
  MonthlyServerReport,
} from './src/types.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const ROOT_DIR = process.cwd();
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const DB_PATH = path.resolve(DATA_DIR, 'resicontrol.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

type SqlParam = string | number | null;

interface DbStatement {
  run: (...params: SqlParam[]) => { lastInsertRowid: number | bigint; changes: number | bigint };
  get: (...params: SqlParam[]) => unknown;
  all: (...params: SqlParam[]) => unknown[];
}

interface DbAdapter {
  exec: (sql: string) => void;
  prepare: (sql: string) => DbStatement;
  engine: 'node:sqlite' | 'sql.js';
}

let db!: DbAdapter;

async function createDbAdapter(dbPath: string): Promise<DbAdapter> {
  try {
    const sqliteMod = await import('node:sqlite');
    const nativeDb = new sqliteMod.DatabaseSync(dbPath);
    nativeDb.exec('PRAGMA journal_mode = WAL;');
    nativeDb.exec('PRAGMA foreign_keys = ON;');
    return {
      engine: 'node:sqlite',
      exec: (sql: string) => nativeDb.exec(sql),
      prepare: (sql: string) => nativeDb.prepare(sql) as unknown as DbStatement,
    };
  } catch (err) {
    console.warn(
      'node:sqlite no disponible en esta versión de Node.js; usando motor SQLite compatible (sql.js):',
      err instanceof Error ? err.message : err
    );
    const { default: initSqlJs } = await import('sql.js');
    const req = createRequire(import.meta.url);
    const wasmPath = req.resolve('sql.js/dist/sql-wasm.wasm');
    const SQL = await initSqlJs({ locateFile: () => wasmPath });

    const existingBuf = fs.existsSync(dbPath) ? new Uint8Array(fs.readFileSync(dbPath)) : undefined;
    const wasmDb = existingBuf ? new SQL.Database(existingBuf) : new SQL.Database();
    let inTx = false;

    const persist = () => {
      const data = Buffer.from(wasmDb.export());
      const tmpPath = `${dbPath}.tmp`;
      fs.writeFileSync(tmpPath, data);
      fs.renameSync(tmpPath, dbPath);
    };

    const normalizeParams = (params: SqlParam[]) =>
      params.map((p) => (p === undefined ? null : p));

    return {
      engine: 'sql.js',
      exec: (sql: string) => {
        const trimmed = sql.trim().toUpperCase();
        if (trimmed === 'BEGIN' || trimmed.startsWith('BEGIN ')) {
          wasmDb.exec(sql);
          inTx = true;
          return;
        }
        if (trimmed === 'COMMIT' || trimmed === 'END') {
          wasmDb.exec(sql);
          inTx = false;
          persist();
          return;
        }
        if (trimmed === 'ROLLBACK') {
          wasmDb.exec(sql);
          inTx = false;
          return;
        }
        wasmDb.exec(sql);
        if (!inTx && !trimmed.startsWith('PRAGMA') && !trimmed.startsWith('SELECT')) {
          persist();
        }
      },
      prepare: (sql: string): DbStatement => ({
        run: (...params: SqlParam[]) => {
          const stmt = wasmDb.prepare(sql);
          try {
            stmt.bind(normalizeParams(params));
            stmt.step();
          } finally {
            stmt.free();
          }
          const changes = wasmDb.getRowsModified();
          const rowRes = wasmDb.exec('SELECT last_insert_rowid() AS id');
          const lastId = Number(rowRes[0]?.values?.[0]?.[0] ?? 0);
          if (!inTx) persist();
          return { lastInsertRowid: lastId, changes };
        },
        get: (...params: SqlParam[]) => {
          const stmt = wasmDb.prepare(sql);
          try {
            stmt.bind(normalizeParams(params));
            if (stmt.step()) {
              return stmt.getAsObject();
            }
            return undefined;
          } finally {
            stmt.free();
          }
        },
        all: (...params: SqlParam[]) => {
          const stmt = wasmDb.prepare(sql);
          const rows: unknown[] = [];
          try {
            stmt.bind(normalizeParams(params));
            while (stmt.step()) {
              rows.push(stmt.getAsObject());
            }
          } finally {
            stmt.free();
          }
          return rows;
        },
      }),
    };
  }
}

async function initDatabaseAndSchema(): Promise<DbAdapter> {
  const adapter = await createDbAdapter(DB_PATH);
  adapter.exec(`
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    row_number INTEGER NOT NULL DEFAULT 1,
    documento TEXT NOT NULL DEFAULT '',
    documento_norm TEXT NOT NULL DEFAULT '',
    codigo_nro TEXT NOT NULL DEFAULT '',
    codigo_norm TEXT NOT NULL DEFAULT '',
    nombres TEXT NOT NULL DEFAULT '',
    apellidos TEXT NOT NULL DEFAULT '',
    fecha_nacimiento TEXT NOT NULL DEFAULT '',
    barrio_residencia TEXT NOT NULL DEFAULT '',
    servicio_figura TEXT NOT NULL DEFAULT '',
    servicio_corresponde TEXT NOT NULL DEFAULT '',
    distrito TEXT NOT NULL DEFAULT '',
    servicio_planilla TEXT NOT NULL DEFAULT '',
    responsable TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK(status IN ('pendiente', 'realizado', 'otro_departamento')),
    month_key TEXT NOT NULL,
    source_file TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    dispatched_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);
  CREATE INDEX IF NOT EXISTS idx_records_month ON records(month_key);
  CREATE INDEX IF NOT EXISTS idx_records_doc_norm ON records(documento_norm);
  CREATE INDEX IF NOT EXISTS idx_records_cod_norm ON records(codigo_norm);

  CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    distrito TEXT NOT NULL DEFAULT '',
    servicio TEXT NOT NULL DEFAULT '',
    responsable TEXT NOT NULL DEFAULT '',
    total_rows INTEGER NOT NULL DEFAULT 0,
    duplicates_detected INTEGER NOT NULL DEFAULT 0,
    uploaded_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL CHECK(level IN ('INFO', 'WARN', 'ERROR')),
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    metadata TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    label TEXT NOT NULL,
    record_count INTEGER NOT NULL DEFAULT 0,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS monthly_server_metrics (
    month_key TEXT PRIMARY KEY,
    total_requests INTEGER NOT NULL DEFAULT 0,
    error_requests INTEGER NOT NULL DEFAULT 0,
    total_latency_ms REAL NOT NULL DEFAULT 0,
    max_latency_ms REAL NOT NULL DEFAULT 0,
    peak_memory_mb REAL NOT NULL DEFAULT 0,
    exports_generated INTEGER NOT NULL DEFAULT 0,
    backups_created INTEGER NOT NULL DEFAULT 0,
    last_updated TEXT NOT NULL
  );
`);

  // Safe migration for existing SQLite databases created before dispatched_at existed
  const recordColumns = adapter.prepare('PRAGMA table_info(records)').all() as Array<{ name: string }>;
  if (!recordColumns.some((c) => c.name === 'dispatched_at')) {
    adapter.exec("ALTER TABLE records ADD COLUMN dispatched_at TEXT NOT NULL DEFAULT '';");
  }

  return adapter;
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function normalizeCode(val: string): string {
  return String(val || '')
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

function normalizeText(val: string): string {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  const names = [
    'Ene',
    'Feb',
    'Mar',
    'Abr',
    'May',
    'Jun',
    'Jul',
    'Ago',
    'Sep',
    'Oct',
    'Nov',
    'Dic',
  ];
  const idx = Number(month) - 1;
  if (idx >= 0 && idx < 12) {
    return `${names[idx]} ${year}`;
  }
  return monthKey;
}

function sanitizeFilename(name: string): string {
  return String(name || 'planilla')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_\-.]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
}

// SSE connected clients
const sseClients = new Set<Response>();

function broadcastSse(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function addSystemLog(
  level: 'INFO' | 'WARN' | 'ERROR',
  category: 'IMPORT' | 'DEDUP' | 'STATUS' | 'EXPORT' | 'BACKUP' | 'SYSTEM' | 'SECURITY',
  message: string,
  details: Record<string, unknown> = {}
): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    'INSERT INTO system_logs (timestamp, level, category, message, details) VALUES (?, ?, ?, ?, ?)'
  );
  const res = stmt.run(now, level, category, message, JSON.stringify(details));
  broadcastSse('log', {
    id: Number(res.lastInsertRowid),
    timestamp: now,
    level,
    category,
    message,
    details: JSON.stringify(details),
  });
}

function addNotification(
  type: 'duplicate_alert' | 'import_success' | 'export_ready' | 'backup_created' | 'system_alert',
  title: string,
  message: string,
  metadata: Record<string, unknown> = {}
): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    'INSERT INTO notifications (timestamp, type, title, message, is_read, metadata) VALUES (?, ?, ?, ?, 0, ?)'
  );
  const res = stmt.run(now, type, title, message, JSON.stringify(metadata));
  broadcastSse('notification', {
    id: Number(res.lastInsertRowid),
    timestamp: now,
    type,
    title,
    message,
    is_read: 0,
    metadata: JSON.stringify(metadata),
  });
}

// Duplicate detection engine using Union-Find across all persisted records
function computeDuplicates(): {
  duplicateMap: Map<number, string[]>;
  clusters: DuplicateCluster[];
} {
  const rows = db
    .prepare('SELECT * FROM records ORDER BY id ASC')
    .all() as unknown as Array<ResidenceRecord & { documento_norm: string; codigo_norm: string }>;

  const n = rows.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const reasonsByIndex = new Map<number, Set<string>>();

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  function union(a: number, b: number, reason: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent[rb] = ra;
    }
    if (!reasonsByIndex.has(a)) reasonsByIndex.set(a, new Set());
    if (!reasonsByIndex.has(b)) reasonsByIndex.set(b, new Set());
    reasonsByIndex.get(a)!.add(reason);
    reasonsByIndex.get(b)!.add(reason);
  }

  const byDoc = new Map<string, number[]>();
  const byCode = new Map<string, number[]>();
  const byIdentity = new Map<string, number[]>();

  for (let i = 0; i < n; i++) {
    const r = rows[i];
    if (r.documento_norm && r.documento_norm.length >= 4) {
      const list = byDoc.get(r.documento_norm) || [];
      list.push(i);
      byDoc.set(r.documento_norm, list);
    }
    if (r.codigo_norm && r.codigo_norm.length >= 3) {
      const list = byCode.get(r.codigo_norm) || [];
      list.push(i);
      byCode.set(r.codigo_norm, list);
    }
    const nameNorm = normalizeText(r.nombres);
    const lastNorm = normalizeText(r.apellidos);
    const dobNorm = normalizeText(r.fecha_nacimiento);
    if (nameNorm && lastNorm && dobNorm) {
      const key = `${nameNorm}|${lastNorm}|${dobNorm}`;
      const list = byIdentity.get(key) || [];
      list.push(i);
      byIdentity.set(key, list);
    }
  }

  for (const [, indices] of byDoc) {
    if (indices.length > 1) {
      for (let k = 1; k < indices.length; k++) {
        union(indices[0], indices[k], 'Documento coincidente');
      }
    }
  }

  for (const [, indices] of byCode) {
    if (indices.length > 1) {
      for (let k = 1; k < indices.length; k++) {
        union(indices[0], indices[k], 'Código/Nro coincidente');
      }
    }
  }

  for (const [, indices] of byIdentity) {
    if (indices.length > 1) {
      for (let k = 1; k < indices.length; k++) {
        union(indices[0], indices[k], 'Nombre, apellido y fecha coincidentes');
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const arr = groups.get(root) || [];
    arr.push(i);
    groups.set(root, arr);
  }

  const duplicateMap = new Map<number, string[]>();
  const clusters: DuplicateCluster[] = [];

  for (const [root, indices] of groups) {
    if (indices.length > 1) {
      const clusterReasons = new Set<string>();
      const clusterRecords: ResidenceRecord[] = [];
      for (const idx of indices) {
        const row = rows[idx];
        const rReasons = Array.from(reasonsByIndex.get(idx) || []);
        for (const reason of rReasons) clusterReasons.add(reason);
        duplicateMap.set(row.id, rReasons);
        clusterRecords.push({
          ...row,
          is_duplicate: true,
          duplicate_reasons: rReasons,
        });
      }
      const lead = clusterRecords[0];
      const matchKey =
        lead.documento || lead.codigo_nro || `${lead.nombres} ${lead.apellidos}`.trim();
      clusters.push({
        clusterId: `cluster-${root}`,
        matchKey,
        reasons: Array.from(clusterReasons),
        records: clusterRecords,
      });
    }
  }

  return { duplicateMap, clusters };
}

function getAllRecordsAnnotated(): ResidenceRecord[] {
  const rows = db
    .prepare('SELECT * FROM records ORDER BY id DESC')
    .all() as unknown as ResidenceRecord[];
  const { duplicateMap } = computeDuplicates();
  return rows.map((r) => {
    const reasons = duplicateMap.get(r.id);
    return {
      ...r,
      is_duplicate: Boolean(reasons && reasons.length > 0),
      duplicate_reasons: reasons || [],
    };
  });
}

function excelCellToString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const dd = String(val.getUTCDate()).padStart(2, '0');
    const mm = String(val.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = val.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  return String(val).trim();
}

function parseExcelDateCell(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '';
  if (typeof raw === 'number' && raw > 1000 && raw < 100000) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${String(parsed.d).padStart(2, '0')}/${String(parsed.m).padStart(2, '0')}/${parsed.y}`;
    }
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return `${String(raw.getUTCDate()).padStart(2, '0')}/${String(raw.getUTCMonth() + 1).padStart(2, '0')}/${raw.getUTCFullYear()}`;
  }
  return String(raw).trim();
}

interface ParsedSheetResult {
  distrito: string;
  servicio: string;
  responsable: string;
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
  }>;
}

function parseWorkbookBuffer(buffer: Buffer): ParsedSheetResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  let distrito = '';
  let servicio = '';
  let responsable = '';
  const allRows: ParsedSheetResult['rows'] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: true,
    });
    if (matrix.length === 0) continue;

    // Scan top rows for DISTRITO:, SERVICIO:, RESPONSABLE:
    for (let r = 0; r < Math.min(8, matrix.length); r++) {
      const row = matrix[r] || [];
      for (let c = 0; c < row.length; c++) {
        const cellText = excelCellToString(row[c]);
        const norm = normalizeText(cellText);
        if (norm.startsWith('distrito')) {
          const inlineVal = cellText.split(':').slice(1).join(':').trim();
          const nextVal = excelCellToString(row[c + 1]);
          if (!distrito) distrito = inlineVal || nextVal;
        } else if (norm === 'servicio:' || norm === 'servicio') {
          const nextVal = excelCellToString(row[c + 1]);
          if (!servicio && nextVal) servicio = nextVal;
        } else if (norm.startsWith('servicio:') && !norm.includes('figura') && !norm.includes('corresponde')) {
          const inlineVal = cellText.split(':').slice(1).join(':').trim();
          const nextVal = excelCellToString(row[c + 1]);
          if (!servicio) servicio = inlineVal || nextVal;
        } else if (norm.startsWith('responsable')) {
          const inlineVal = cellText.split(':').slice(1).join(':').trim();
          let nextVal = '';
          for (let nc = c + 1; nc < row.length; nc++) {
            const candidate = excelCellToString(row[nc]);
            if (candidate) {
              nextVal = candidate;
              break;
            }
          }
          if (!responsable) responsable = inlineVal || nextVal;
        }
      }
    }

    // Locate header row
    let headerRowIdx = -1;
    let colMap = {
      row_number: -1,
      documento: -1,
      codigo_nro: -1,
      nombres: -1,
      apellidos: -1,
      fecha_nacimiento: -1,
      barrio_residencia: -1,
      servicio_figura: -1,
      servicio_corresponde: -1,
    };

    for (let r = 0; r < Math.min(15, matrix.length); r++) {
      const row = matrix[r] || [];
      const tempMap = { ...colMap };
      let matches = 0;

      for (let c = 0; c < row.length; c++) {
        const h = normalizeText(excelCellToString(row[c]));
        if (!h) continue;
        if (h === 'n°' || h === 'nº' || h === 'nro' || h === 'no' || h === 'n') {
          tempMap.row_number = c;
        } else if (h.includes('documento') || h === 'ci' || h === 'dni' || h === 'cedula') {
          tempMap.documento = c;
          matches++;
        } else if (h.includes('codigo') || h.includes('cod')) {
          tempMap.codigo_nro = c;
          matches++;
        } else if (h.includes('nombre')) {
          tempMap.nombres = c;
          matches++;
        } else if (h.includes('apellido')) {
          tempMap.apellidos = c;
          matches++;
        } else if (h.includes('nacimiento') || h.includes('fecha')) {
          tempMap.fecha_nacimiento = c;
          matches++;
        } else if (h.includes('barrio') || h.includes('residencia') || h.includes('direccion')) {
          tempMap.barrio_residencia = c;
          matches++;
        } else if (h.includes('figura')) {
          tempMap.servicio_figura = c;
          matches++;
        } else if (h.includes('corresponde')) {
          tempMap.servicio_corresponde = c;
          matches++;
        }
      }

      if (matches >= 3) {
        headerRowIdx = r;
        colMap = tempMap;
        break;
      }
    }

    // Fallback positional mapping if exact standard layout without recognizable header
    if (headerRowIdx === -1 && matrix.length > 0) {
      headerRowIdx = 0;
      colMap = {
        row_number: 0,
        documento: 1,
        codigo_nro: 2,
        nombres: 3,
        apellidos: 4,
        fecha_nacimiento: 5,
        barrio_residencia: 6,
        servicio_figura: 7,
        servicio_corresponde: 8,
      };
    }

    for (let r = headerRowIdx + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      const getCol = (idx: number) => (idx >= 0 && idx < row.length ? row[idx] : '');

      const documento = excelCellToString(getCol(colMap.documento));
      const codigo_nro = excelCellToString(getCol(colMap.codigo_nro));
      const nombres = excelCellToString(getCol(colMap.nombres));
      const apellidos = excelCellToString(getCol(colMap.apellidos));
      const fecha_nacimiento = parseExcelDateCell(getCol(colMap.fecha_nacimiento));
      const barrio_residencia = excelCellToString(getCol(colMap.barrio_residencia));
      const servicio_figura = excelCellToString(getCol(colMap.servicio_figura));
      const servicio_corresponde = excelCellToString(getCol(colMap.servicio_corresponde));

      // Skip empty numbered template rows (e.g. row has only N° 1..25 and all other cells empty)
      const hasContent = Boolean(
        documento ||
          codigo_nro ||
          nombres ||
          apellidos ||
          fecha_nacimiento ||
          barrio_residencia ||
          servicio_figura ||
          servicio_corresponde
      );
      if (!hasContent) continue;

      const rawNum = Number(excelCellToString(getCol(colMap.row_number)));
      const row_number = Number.isFinite(rawNum) && rawNum > 0 ? rawNum : allRows.length + 1;

      allRows.push({
        row_number,
        documento,
        codigo_nro,
        nombres,
        apellidos,
        fecha_nacimiento,
        barrio_residencia,
        servicio_figura,
        servicio_corresponde,
      });
    }
  }

  return { distrito, servicio, responsable, rows: allRows };
}

async function generateOfficialExcelBuffer(params: {
  records: ResidenceRecord[];
  distrito?: string;
  servicio?: string;
  responsable?: string;
  minRows?: number;
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ResiControl';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Cambio de Residencia', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  sheet.columns = [
    { key: 'nro', width: 6 },
    { key: 'documento', width: 15 },
    { key: 'codigo_nro', width: 15 },
    { key: 'nombres', width: 22 },
    { key: 'apellidos', width: 22 },
    { key: 'fecha_nacimiento', width: 20 },
    { key: 'barrio_residencia', width: 25 },
    { key: 'servicio_figura', width: 25 },
    { key: 'servicio_corresponde', width: 27 },
  ];

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FF000000' } },
    left: { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } },
  };

  const firstRec = params.records[0];
  const distritoVal = params.distrito ?? firstRec?.distrito ?? '';
  const servicioVal = params.servicio ?? firstRec?.servicio_planilla ?? '';
  const responsableVal = params.responsable ?? firstRec?.responsable ?? '';

  // Row 1: DISTRITO | val | SERVICIO | val | RESPONSABLE | val (F1:I1 merged)
  const r1 = sheet.getRow(1);
  r1.height = 20;
  r1.getCell(1).value = 'DISTRITO:';
  r1.getCell(2).value = distritoVal;
  r1.getCell(3).value = 'SERVICIO:';
  r1.getCell(4).value = servicioVal;
  r1.getCell(5).value = 'RESPONSABLE:';
  r1.getCell(6).value = responsableVal;
  sheet.mergeCells('F1:I1');

  for (let c = 1; c <= 9; c++) {
    const cell = r1.getCell(c);
    cell.border = thinBorder;
    cell.font = {
      name: 'Calibri',
      size: 10,
      bold: c === 1 || c === 3 || c === 5,
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  }

  // Row 2: Title banner A2:I2 merged
  const r2 = sheet.getRow(2);
  r2.height = 22;
  sheet.mergeCells('A2:I2');
  r2.getCell(1).value = 'NIÑOS CON RESIDENCIA EN LA ZONA DE RESPONSABILIDAD';
  for (let c = 1; c <= 9; c++) {
    const cell = r2.getCell(c);
    cell.border = thinBorder;
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9D9D9' },
    };
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }

  // Row 3: Column headers
  const headers = [
    'N°',
    'DOCUMENTO',
    'CODIGO/ NRO',
    'NOMBRES',
    'APELLIDOS',
    'FECHA DE NACIMIENTO',
    'BARRIO DE RESIDENCIA',
    'SERVICIO DONDE FIGURA',
    'SERVICIO DONDE CORRESPONDE',
  ];
  const r3 = sheet.getRow(3);
  r3.height = 24;
  headers.forEach((h, idx) => {
    const cell = r3.getCell(idx + 1);
    cell.value = h;
    cell.border = thinBorder;
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9D9D9' },
    };
    cell.font = { name: 'Calibri', size: 9, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });

  // Data rows (minimum 25 rows like the PDF template)
  const totalRows = Math.max(params.minRows ?? 25, params.records.length);
  for (let i = 0; i < totalRows; i++) {
    const rec = params.records[i];
    const row = sheet.getRow(4 + i);
    row.height = 19;

    const values = [
      i + 1,
      rec ? rec.documento : '',
      rec ? rec.codigo_nro : '',
      rec ? rec.nombres : '',
      rec ? rec.apellidos : '',
      rec ? rec.fecha_nacimiento : '',
      rec ? rec.barrio_residencia : '',
      rec ? rec.servicio_figura : '',
      rec ? rec.servicio_corresponde : '',
    ];

    values.forEach((v, idx) => {
      const cell = row.getCell(idx + 1);
      cell.value = v;
      cell.border = thinBorder;
      cell.font = { name: 'Calibri', size: 10 };
      cell.alignment = {
        vertical: 'middle',
        horizontal: idx === 0 || idx === 5 ? 'center' : 'left',
      };
    });
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

// In-memory sliding window for real-time request rate and latency tracking
const recentRequests: Array<{ ts: number; latencyMs: number; isError: boolean }> = [];
const rateLimiter = new Map<string, { count: number; resetAt: number }>();

function recordServerMetric(latencyMs: number, isError: boolean): void {
  const now = Date.now();
  recentRequests.push({ ts: now, latencyMs, isError });
  // Keep last 5 minutes
  const cutoff = now - 5 * 60 * 1000;
  while (recentRequests.length > 0 && recentRequests[0].ts < cutoff) {
    recentRequests.shift();
  }

  const mk = currentMonthKey();
  const memMb = Math.round((process.memoryUsage().rss / (1024 * 1024)) * 100) / 100;
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO monthly_server_metrics (
      month_key, total_requests, error_requests, total_latency_ms, max_latency_ms, peak_memory_mb, exports_generated, backups_created, last_updated
    ) VALUES (?, 1, ?, ?, ?, ?, 0, 0, ?)
    ON CONFLICT(month_key) DO UPDATE SET
      total_requests = total_requests + 1,
      error_requests = error_requests + excluded.error_requests,
      total_latency_ms = total_latency_ms + excluded.total_latency_ms,
      max_latency_ms = MAX(max_latency_ms, excluded.max_latency_ms),
      peak_memory_mb = MAX(peak_memory_mb, excluded.peak_memory_mb),
      last_updated = excluded.last_updated
  `).run(mk, isError ? 1 : 0, latencyMs, latencyMs, memMb, nowIso);
}

function getMetricsSnapshot(): ServerMetricsSnapshot {
  const mem = process.memoryUsage();
  const loads = os.loadavg();
  const cutoff1m = Date.now() - 60 * 1000;
  const lastMin = recentRequests.filter((r) => r.ts >= cutoff1m);
  const avgLat =
    lastMin.length > 0
      ? Math.round((lastMin.reduce((acc, r) => acc + r.latencyMs, 0) / lastMin.length) * 100) / 100
      : 0;
  const errCount = lastMin.filter((r) => r.isError).length;
  const errRate = lastMin.length > 0 ? Math.round((errCount / lastMin.length) * 10000) / 100 : 0;

  let dbSizeKb = 0;
  try {
    dbSizeKb = Math.round((fs.statSync(DB_PATH).size / 1024) * 10) / 10;
  } catch {
    dbSizeKb = 0;
  }

  return {
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    cpuCores: os.cpus().length || 1,
    loadAvg1m: Math.round((loads[0] || 0) * 100) / 100,
    loadAvg5m: Math.round((loads[1] || 0) * 100) / 100,
    loadAvg15m: Math.round((loads[2] || 0) * 100) / 100,
    memoryRssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
    memoryHeapUsedMb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
    memoryHeapTotalMb: Math.round((mem.heapTotal / (1024 * 1024)) * 10) / 10,
    systemTotalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
    systemFreeMemMb: Math.round(os.freemem() / (1024 * 1024)),
    dbSizeKb,
    activeSseClients: sseClients.size,
    avgLatencyMs: avgLat,
    requestsLastMinute: lastMin.length,
    errorRatePercent: errRate,
  };
}

async function startServer(): Promise<void> {
  db = await initDatabaseAndSchema();
  const app = express();
  app.set('trust proxy', true);

  // Security headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '0');
    next();
  });

  app.use(express.json({ limit: '20mb' }));

  // Latency & telemetry instrumentation for /api/* routes (excluding SSE stream)
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/events') {
      next();
      return;
    }
    const start = performance.now();
    res.on('finish', () => {
      const latency = performance.now() - start;
      recordServerMetric(latency, res.statusCode >= 500);
    });
    next();
  });

  // Lightweight rate limiter for heavy/mutating routes
  function limitHeavy(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip || 'local';
    const now = Date.now();
    const bucket = rateLimiter.get(ip);
    if (!bucket || bucket.resetAt < now) {
      rateLimiter.set(ip, { count: 1, resetAt: now + 60_000 });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > 120) {
      addSystemLog('WARN', 'SECURITY', 'Límite de solicitudes excedido', { ip, path: req.path });
      res.status(429).json({ error: 'Demasiadas solicitudes. Intente en unos segundos.' });
      return;
    }
    next();
  }

  // Health & readiness probes
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'ResiControl',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/ready', (_req: Request, res: Response) => {
    try {
      const row = db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      if (row?.ok === 1) {
        res.json({
          ready: true,
          database: db.engine === 'node:sqlite' ? 'sqlite-wal' : 'sqljs-sqlite',
          timestamp: new Date().toISOString(),
        });
        return;
      }
      res.status(503).json({ ready: false });
    } catch {
      res.status(503).json({ ready: false });
    }
  });

  // Real-time SSE stream
  app.get('/api/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.add(res);
    res.write(`event: connected\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);

    const heartbeat = setInterval(() => {
      try {
        res.write(`event: metrics\ndata: ${JSON.stringify(getMetricsSnapshot())}\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 5000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // Records list + duplicate clusters
  app.get('/api/records', (req: Request, res: Response) => {
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : 'all';
    const monthFilter = typeof req.query.month === 'string' ? req.query.month : 'all';
    const distritoFilter = typeof req.query.distrito === 'string' ? req.query.distrito : 'all';
    const servicioFilter = typeof req.query.servicio === 'string' ? req.query.servicio : 'all';
    const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : '';
    const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : '';
    const search = typeof req.query.q === 'string' ? normalizeText(req.query.q) : '';
    const onlyDuplicates = req.query.duplicates === 'true';

    let records = getAllRecordsAnnotated();

    if (statusFilter !== 'all') {
      records = records.filter((r) => r.status === statusFilter);
    }
    if (monthFilter !== 'all') {
      records = records.filter((r) => r.month_key === monthFilter);
    }
    if (distritoFilter !== 'all') {
      records = records.filter((r) => r.distrito === distritoFilter);
    }
    if (servicioFilter !== 'all') {
      records = records.filter((r) => r.servicio_planilla === servicioFilter);
    }
    if (dateFrom) {
      records = records.filter((r) => (r.created_at || '').slice(0, 10) >= dateFrom);
    }
    if (dateTo) {
      records = records.filter((r) => (r.created_at || '').slice(0, 10) <= dateTo);
    }
    if (onlyDuplicates) {
      records = records.filter((r) => r.is_duplicate);
    }
    if (search) {
      records = records.filter((r) => {
        const hay = normalizeText(
          `${r.documento} ${r.codigo_nro} ${r.nombres} ${r.apellidos} ${r.barrio_residencia} ${r.servicio_figura} ${r.servicio_corresponde} ${r.distrito} ${r.responsable}`
        );
        return hay.includes(search);
      });
    }

    const { clusters } = computeDuplicates();
    res.json({ records, duplicateClusters: clusters });
  });

  // Manual single record creation
  app.post('/api/records', limitHeavy, (req: Request, res: Response) => {
    const body = req.body as Partial<ResidenceRecord>;
    const documento = String(body.documento || '').trim();
    const codigo_nro = String(body.codigo_nro || '').trim();
    const nombres = String(body.nombres || '').trim();
    const apellidos = String(body.apellidos || '').trim();

    if (!documento && !codigo_nro && !nombres && !apellidos) {
      res.status(400).json({ error: 'Debe ingresar al menos documento, código o nombre.' });
      return;
    }

    const validStatuses: RecordStatus[] = ['pendiente', 'realizado', 'otro_departamento'];
    const status: RecordStatus = validStatuses.includes(body.status as RecordStatus)
      ? (body.status as RecordStatus)
      : 'pendiente';
    const monthKey = /^\d{4}-\d{2}$/.test(String(body.month_key || ''))
      ? String(body.month_key)
      : currentMonthKey();
    const now = new Date().toISOString();

    const maxRow = db.prepare('SELECT COALESCE(MAX(row_number), 0) AS m FROM records').get() as {
      m: number;
    };

    const insertRes = db
      .prepare(`
        INSERT INTO records (
          row_number, documento, documento_norm, codigo_nro, codigo_norm,
          nombres, apellidos, fecha_nacimiento, barrio_residencia,
          servicio_figura, servicio_corresponde, distrito, servicio_planilla,
          responsable, status, month_key, source_file, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        Number(body.row_number) || maxRow.m + 1,
        documento,
        normalizeCode(documento),
        codigo_nro,
        normalizeCode(codigo_nro),
        nombres,
        apellidos,
        String(body.fecha_nacimiento || '').trim(),
        String(body.barrio_residencia || '').trim(),
        String(body.servicio_figura || '').trim(),
        String(body.servicio_corresponde || '').trim(),
        String(body.distrito || '').trim(),
        String(body.servicio_planilla || '').trim(),
        String(body.responsable || '').trim(),
        status,
        monthKey,
        'Ingreso Manual',
        String(body.notes || '').trim(),
        now,
        now
      );

    const newId = Number(insertRes.lastInsertRowid);
    const { duplicateMap } = computeDuplicates();
    const dupReasons = duplicateMap.get(newId);

    if (dupReasons && dupReasons.length > 0) {
      addNotification(
        'duplicate_alert',
        'Duplicado detectado en ingreso manual',
        `${nombres} ${apellidos} (Doc: ${documento || 'S/D'}) coincide con un registro existente (${dupReasons.join(', ')}).`,
        { recordId: newId, reasons: dupReasons }
      );
      addSystemLog('WARN', 'DEDUP', 'Registro manual detectado como duplicado', {
        recordId: newId,
        reasons: dupReasons,
      });
    } else {
      addSystemLog('INFO', 'IMPORT', 'Registro agregado manualmente', { recordId: newId });
    }

    broadcastSse('data_changed', { reason: 'record_created', id: newId });
    res.status(201).json({ id: newId, is_duplicate: Boolean(dupReasons?.length) });
  });

  // Update record fields or status
  app.patch('/api/records/:id', limitHeavy, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }

    const existing = db.prepare('SELECT * FROM records WHERE id = ?').get(id) as
      | ResidenceRecord
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Registro no encontrado' });
      return;
    }

    const body = req.body as Partial<ResidenceRecord>;
    const validStatuses: RecordStatus[] = ['pendiente', 'realizado', 'otro_departamento'];
    const status =
      body.status && validStatuses.includes(body.status) ? body.status : existing.status;

    const documento = body.documento !== undefined ? String(body.documento).trim() : existing.documento;
    const codigo_nro =
      body.codigo_nro !== undefined ? String(body.codigo_nro).trim() : existing.codigo_nro;
    const nombres = body.nombres !== undefined ? String(body.nombres).trim() : existing.nombres;
    const apellidos =
      body.apellidos !== undefined ? String(body.apellidos).trim() : existing.apellidos;
    const fecha_nacimiento =
      body.fecha_nacimiento !== undefined
        ? String(body.fecha_nacimiento).trim()
        : existing.fecha_nacimiento;
    const barrio_residencia =
      body.barrio_residencia !== undefined
        ? String(body.barrio_residencia).trim()
        : existing.barrio_residencia;
    const servicio_figura =
      body.servicio_figura !== undefined
        ? String(body.servicio_figura).trim()
        : existing.servicio_figura;
    const servicio_corresponde =
      body.servicio_corresponde !== undefined
        ? String(body.servicio_corresponde).trim()
        : existing.servicio_corresponde;
    const distrito = body.distrito !== undefined ? String(body.distrito).trim() : existing.distrito;
    const servicio_planilla =
      body.servicio_planilla !== undefined
        ? String(body.servicio_planilla).trim()
        : existing.servicio_planilla;
    const responsable =
      body.responsable !== undefined ? String(body.responsable).trim() : existing.responsable;
    const month_key =
      body.month_key && /^\d{4}-\d{2}$/.test(body.month_key) ? body.month_key : existing.month_key;
    const notes = body.notes !== undefined ? String(body.notes).trim() : existing.notes;

    const now = new Date().toISOString();

    db.prepare(`
      UPDATE records SET
        documento = ?, documento_norm = ?, codigo_nro = ?, codigo_norm = ?,
        nombres = ?, apellidos = ?, fecha_nacimiento = ?, barrio_residencia = ?,
        servicio_figura = ?, servicio_corresponde = ?, distrito = ?, servicio_planilla = ?,
        responsable = ?, status = ?, month_key = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(
      documento,
      normalizeCode(documento),
      codigo_nro,
      normalizeCode(codigo_nro),
      nombres,
      apellidos,
      fecha_nacimiento,
      barrio_residencia,
      servicio_figura,
      servicio_corresponde,
      distrito,
      servicio_planilla,
      responsable,
      status,
      month_key,
      notes,
      now,
      id
    );

    if (status !== existing.status) {
      addSystemLog('INFO', 'STATUS', `Estado actualizado a "${status}" para registro #${id}`, {
        id,
        from: existing.status,
        to: status,
      });
    } else {
      addSystemLog('INFO', 'STATUS', `Registro #${id} editado`, { id });
    }

    const { duplicateMap } = computeDuplicates();
    const dupReasons = duplicateMap.get(id);
    if (dupReasons && dupReasons.length > 0 && body.status === undefined) {
      addNotification(
        'duplicate_alert',
        'Coincidencia duplicada tras edición',
        `El registro #${id} (${nombres} ${apellidos}) presenta duplicidad: ${dupReasons.join(', ')}.`,
        { recordId: id, reasons: dupReasons }
      );
    }

    broadcastSse('data_changed', { reason: 'record_updated', id });
    res.json({ ok: true, is_duplicate: Boolean(dupReasons?.length) });
  });

  // Bulk status update
  app.post('/api/records/bulk-status', limitHeavy, (req: Request, res: Response) => {
    const body = req.body as { ids?: unknown; status?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.map(Number).filter((x) => Number.isInteger(x) && x > 0)
      : [];
    const validStatuses: RecordStatus[] = ['pendiente', 'realizado', 'otro_departamento'];
    if (ids.length === 0 || !validStatuses.includes(body.status as RecordStatus)) {
      res.status(400).json({ error: 'Selección o estado inválido.' });
      return;
    }

    const status = body.status as RecordStatus;
    const now = new Date().toISOString();
    const stmt = db.prepare('UPDATE records SET status = ?, updated_at = ? WHERE id = ?');
    db.exec('BEGIN');
    try {
      for (const id of ids) {
        stmt.run(status, now, id);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    addSystemLog('INFO', 'STATUS', `Actualización masiva: ${ids.length} registros -> ${status}`, {
      count: ids.length,
      status,
    });
    broadcastSse('data_changed', { reason: 'bulk_status', count: ids.length });
    res.json({ ok: true, updated: ids.length });
  });

  // Mark or unmark records as remitted (dispatched_at)
  app.post('/api/records/mark-dispatched', limitHeavy, (req: Request, res: Response) => {
    const body = req.body as { ids?: unknown; dispatchedAt?: string | null };
    const ids = Array.isArray(body.ids)
      ? body.ids.map(Number).filter((x) => Number.isInteger(x) && x > 0)
      : [];
    if (ids.length === 0) {
      res.status(400).json({ error: 'No se indicaron registros para actualizar.' });
      return;
    }

    const now = new Date().toISOString();
    const dispatchedVal =
      body.dispatchedAt === null || body.dispatchedAt === ''
        ? ''
        : typeof body.dispatchedAt === 'string' && body.dispatchedAt.trim()
        ? body.dispatchedAt.trim()
        : now;

    const stmt = db.prepare(
      'UPDATE records SET dispatched_at = ?, updated_at = ? WHERE id = ?'
    );
    db.exec('BEGIN');
    try {
      for (const id of ids) {
        stmt.run(dispatchedVal, now, id);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    addSystemLog(
      'INFO',
      'EXPORT',
      dispatchedVal
        ? `${ids.length} registro(s) marcado(s) como remitido(s) para evitar reenvío`
        : `${ids.length} registro(s) reabierto(s) para remisión`,
      { count: ids.length, dispatchedVal }
    );
    broadcastSse('data_changed', { reason: 'records_dispatched', count: ids.length });
    res.json({ ok: true, updated: ids.length, dispatched_at: dispatchedVal });
  });

  // Delete single record
  app.delete('/api/records/:id', limitHeavy, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }
    const del = db.prepare('DELETE FROM records WHERE id = ?').run(id);
    if (del.changes === 0) {
      res.status(404).json({ error: 'Registro no encontrado' });
      return;
    }
    addSystemLog('INFO', 'DEDUP', `Registro #${id} eliminado`, { id });
    broadcastSse('data_changed', { reason: 'record_deleted', id });
    res.json({ ok: true });
  });

  // Auto-resolve exact duplicates (keep earliest or latest record per cluster)
  app.post('/api/duplicates/resolve', limitHeavy, (req: Request, res: Response) => {
    const keepStrategy = req.body?.keep === 'latest' ? 'latest' : 'earliest';
    const { clusters } = computeDuplicates();
    if (clusters.length === 0) {
      res.json({ removed: 0 });
      return;
    }

    const deleteStmt = db.prepare('DELETE FROM records WHERE id = ?');
    let removed = 0;

    db.exec('BEGIN');
    try {
      for (const cluster of clusters) {
        const sorted = [...cluster.records].sort((a, b) => a.id - b.id);
        const toKeep = keepStrategy === 'latest' ? sorted[sorted.length - 1] : sorted[0];
        for (const rec of sorted) {
          if (rec.id !== toKeep.id) {
            deleteStmt.run(rec.id);
            removed++;
          }
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    addSystemLog(
      'INFO',
      'DEDUP',
      `Depuración automática completada: ${removed} registros redundantes eliminados`,
      { clusters: clusters.length, removed, keepStrategy }
    );
    broadcastSse('data_changed', { reason: 'duplicates_resolved', removed });
    res.json({ ok: true, removed });
  });

  // Import Excel (.xlsx, .xls, .csv) via base64 JSON payload
  app.post('/api/import', limitHeavy, (req: Request, res: Response) => {
    const body = req.body as {
      filename?: string;
      base64?: string;
      monthKey?: string;
      distritoOverride?: string;
      servicioOverride?: string;
      responsableOverride?: string;
    };

    const filename = String(body.filename || 'planilla.xlsx').trim();
    const ext = path.extname(filename).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
      res.status(400).json({ error: 'Formato no soportado. Suba archivos .xlsx, .xls o .csv.' });
      return;
    }

    if (!body.base64 || typeof body.base64 !== 'string') {
      res.status(400).json({ error: 'Archivo vacío o inválido.' });
      return;
    }

    const cleanBase64 = body.base64.includes(',') ? body.base64.split(',')[1] : body.base64;
    const buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer.length === 0 || buffer.length > 15 * 1024 * 1024) {
      res.status(400).json({ error: 'El archivo excede el límite de 15 MB o está vacío.' });
      return;
    }

    let parsed: ParsedSheetResult;
    try {
      parsed = parseWorkbookBuffer(buffer);
    } catch (err) {
      addSystemLog('ERROR', 'IMPORT', `Error al leer planilla ${filename}`, {
        error: err instanceof Error ? err.message : 'Error desconocido',
      });
      res.status(400).json({ error: 'No se pudo procesar el archivo Excel. Verifique que no esté dañado.' });
      return;
    }

    if (parsed.rows.length === 0) {
      res.status(400).json({
        error: 'No se encontraron filas con datos en la planilla (las filas vacías de plantilla se omiten).',
      });
      return;
    }

    const monthKey = /^\d{4}-\d{2}$/.test(String(body.monthKey || ''))
      ? String(body.monthKey)
      : currentMonthKey();

    const distrito = String(body.distritoOverride || parsed.distrito || '').trim();
    const servicio = String(body.servicioOverride || parsed.servicio || '').trim();
    const responsable = String(body.responsableOverride || parsed.responsable || '').trim();
    const now = new Date().toISOString();

    const insertStmt = db.prepare(`
      INSERT INTO records (
        row_number, documento, documento_norm, codigo_nro, codigo_norm,
        nombres, apellidos, fecha_nacimiento, barrio_residencia,
        servicio_figura, servicio_corresponde, distrito, servicio_planilla,
        responsable, status, month_key, source_file, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, '', ?, ?)
    `);

    const insertedIds: number[] = [];
    db.exec('BEGIN');
    try {
      for (const r of parsed.rows) {
        const resInsert = insertStmt.run(
          r.row_number,
          r.documento,
          normalizeCode(r.documento),
          r.codigo_nro,
          normalizeCode(r.codigo_nro),
          r.nombres,
          r.apellidos,
          r.fecha_nacimiento,
          r.barrio_residencia,
          r.servicio_figura,
          r.servicio_corresponde,
          distrito,
          servicio,
          responsable,
          monthKey,
          filename,
          now,
          now
        );
        insertedIds.push(Number(resInsert.lastInsertRowid));
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    // Check duplicates involving newly inserted records
    const { duplicateMap, clusters } = computeDuplicates();
    const duplicatesInBatch = insertedIds.filter((id) => duplicateMap.has(id)).length;

    db.prepare(`
      INSERT INTO uploads (filename, distrito, servicio, responsable, total_rows, duplicates_detected, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(filename, distrito, servicio, responsable, insertedIds.length, duplicatesInBatch, now);

    addSystemLog('INFO', 'IMPORT', `Planilla "${filename}" importada (${insertedIds.length} registros)`, {
      filename,
      totalRows: insertedIds.length,
      duplicatesInBatch,
      distrito,
      servicio,
    });

    addNotification(
      'import_success',
      'Planilla Excel cargada correctamente',
      `Se incorporaron ${insertedIds.length} registros desde "${filename}" (${monthKey}).`,
      { filename, count: insertedIds.length }
    );

    if (duplicatesInBatch > 0) {
      addNotification(
        'duplicate_alert',
        `Alerta automática: ${duplicatesInBatch} duplicado(s) detectado(s)`,
        `La carga de "${filename}" generó ${duplicatesInBatch} registro(s) redundante(s) repartidos en ${clusters.length} grupo(s). Puede filtrarlos y depurarlos ahora.`,
        { filename, duplicatesInBatch, totalClusters: clusters.length }
      );
      addSystemLog(
        'WARN',
        'DEDUP',
        `Detección automática: ${duplicatesInBatch} duplicados encontrados tras importar "${filename}"`,
        { filename, duplicatesInBatch, totalClusters: clusters.length }
      );
    }

    broadcastSse('data_changed', {
      reason: 'excel_imported',
      inserted: insertedIds.length,
      duplicatesInBatch,
    });

    res.status(201).json({
      ok: true,
      imported: insertedIds.length,
      duplicatesDetected: duplicatesInBatch,
      totalDuplicateClusters: clusters.length,
      metadata: { distrito, servicio, responsable },
    });
  });

  // Preview Excel without saving (for interactive upload preview)
  app.post('/api/import/preview', limitHeavy, (req: Request, res: Response) => {
    const body = req.body as { filename?: string; base64?: string };
    if (!body.base64) {
      res.status(400).json({ error: 'Archivo vacío' });
      return;
    }
    const cleanBase64 = body.base64.includes(',') ? body.base64.split(',')[1] : body.base64;
    const buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer.length === 0 || buffer.length > 15 * 1024 * 1024) {
      res.status(400).json({ error: 'Tamaño de archivo inválido' });
      return;
    }

    try {
      const parsed = parseWorkbookBuffer(buffer);
      // Check against existing DB for pre-import duplicate warning
      const existing = db
        .prepare('SELECT documento_norm, codigo_norm, nombres, apellidos, fecha_nacimiento FROM records')
        .all() as Array<{
        documento_norm: string;
        codigo_norm: string;
        nombres: string;
        apellidos: string;
        fecha_nacimiento: string;
      }>;

      const docSet = new Set(existing.map((e) => e.documento_norm).filter((x) => x.length >= 4));
      const codSet = new Set(existing.map((e) => e.codigo_norm).filter((x) => x.length >= 3));
      const idSet = new Set(
        existing
          .filter((e) => e.nombres && e.apellidos && e.fecha_nacimiento)
          .map(
            (e) =>
              `${normalizeText(e.nombres)}|${normalizeText(e.apellidos)}|${normalizeText(e.fecha_nacimiento)}`
          )
      );

      let potentialDuplicates = 0;
      const seenInFileDocs = new Set<string>();
      const seenInFileCodes = new Set<string>();

      const previewRows = parsed.rows.map((r) => {
        const dNorm = normalizeCode(r.documento);
        const cNorm = normalizeCode(r.codigo_nro);
        const iNorm =
          r.nombres && r.apellidos && r.fecha_nacimiento
            ? `${normalizeText(r.nombres)}|${normalizeText(r.apellidos)}|${normalizeText(r.fecha_nacimiento)}`
            : '';

        const dup =
          (dNorm.length >= 4 && (docSet.has(dNorm) || seenInFileDocs.has(dNorm))) ||
          (cNorm.length >= 3 && (codSet.has(cNorm) || seenInFileCodes.has(cNorm))) ||
          (iNorm !== '' && idSet.has(iNorm));

        if (dNorm.length >= 4) seenInFileDocs.add(dNorm);
        if (cNorm.length >= 3) seenInFileCodes.add(cNorm);
        if (dup) potentialDuplicates++;

        return { ...r, potentialDuplicate: dup };
      });

      res.json({
        distrito: parsed.distrito,
        servicio: parsed.servicio,
        responsable: parsed.responsable,
        totalRows: previewRows.length,
        potentialDuplicates,
        rows: previewRows,
      });
    } catch {
      res.status(400).json({ error: 'No se pudo analizar el archivo Excel.' });
    }
  });

  // Export official Excel matching attached PDF template
  app.get('/api/export/excel', async (req: Request, res: Response) => {
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : 'otro_departamento';
    const monthFilter = typeof req.query.month === 'string' ? req.query.month : 'all';
    const distritoFilter = typeof req.query.distritoFilter === 'string' ? req.query.distritoFilter : 'all';
    const servicioFilter = typeof req.query.servicioFilter === 'string' ? req.query.servicioFilter : 'all';
    const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : '';
    const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : '';
    const distritoOverride = typeof req.query.distrito === 'string' ? req.query.distrito : undefined;
    const servicioOverride = typeof req.query.servicio === 'string' ? req.query.servicio : undefined;
    const responsableOverride =
      typeof req.query.responsable === 'string' ? req.query.responsable : undefined;
    const blankTemplate = req.query.template === 'true';
    const includeDispatched = req.query.includeDispatched === 'true';

    let records: ResidenceRecord[] = [];
    if (!blankTemplate) {
      records = getAllRecordsAnnotated();
      if (statusFilter !== 'all') {
        records = records.filter((r) => r.status === statusFilter);
      }
      if (monthFilter !== 'all') {
        records = records.filter((r) => r.month_key === monthFilter);
      }
      if (distritoFilter !== 'all') {
        records = records.filter((r) => r.distrito === distritoFilter);
      }
      if (servicioFilter !== 'all') {
        records = records.filter((r) => r.servicio_planilla === servicioFilter);
      }
      if (dateFrom) {
        records = records.filter((r) => (r.created_at || '').slice(0, 10) >= dateFrom);
      }
      if (dateTo) {
        records = records.filter((r) => (r.created_at || '').slice(0, 10) <= dateTo);
      }
      if (statusFilter === 'otro_departamento' && !includeDispatched) {
        records = records.filter((r) => !r.dispatched_at);
      }
    }

    const buffer = await generateOfficialExcelBuffer({
      records,
      distrito: distritoOverride,
      servicio: servicioOverride,
      responsable: responsableOverride,
      minRows: 25,
    });

    const now = new Date().toISOString();
    if (!blankTemplate && statusFilter === 'otro_departamento' && records.length > 0) {
      const markStmt = db.prepare(
        'UPDATE records SET dispatched_at = ?, updated_at = ? WHERE id = ?'
      );
      db.exec('BEGIN');
      try {
        for (const r of records) {
          if (!r.dispatched_at) {
            markStmt.run(now, now, r.id);
          }
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      broadcastSse('data_changed', { reason: 'records_dispatched', count: records.length });
    }

    const mk = currentMonthKey();
    db.prepare(`
      INSERT INTO monthly_server_metrics (month_key, exports_generated, last_updated)
      VALUES (?, 1, ?)
      ON CONFLICT(month_key) DO UPDATE SET
        exports_generated = exports_generated + 1,
        last_updated = excluded.last_updated
    `).run(mk, now);

    const labelPart = blankTemplate
      ? 'PLANTILLA'
      : statusFilter === 'otro_departamento'
      ? 'OTRO_DEPARTAMENTO'
      : statusFilter.toUpperCase();
    const servicioName = sanitizeFilename(
      servicioOverride || records[0]?.servicio_planilla || labelPart
    );
    const filename = `CAMBIO_DE_RESIDENCIA_-_${servicioName}.xlsx`;

    if (!blankTemplate) {
      addSystemLog('INFO', 'EXPORT', `Planilla Excel "${filename}" exportada (${records.length} filas)`, {
        statusFilter,
        count: records.length,
      });
      addNotification(
        'export_ready',
        'Planilla Excel generada para envío',
        `Se generó "${filename}" con ${records.length} registro(s) filtrado(s) (${labelPart}).`,
        { filename, count: records.length }
      );
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  // Analytics & real-time monthly progress
  app.get('/api/analytics', (_req: Request, res: Response) => {
    const records = getAllRecordsAnnotated();
    const { clusters } = computeDuplicates();

    const total = records.length;
    const realizado = records.filter((r) => r.status === 'realizado').length;
    const pendiente = records.filter((r) => r.status === 'pendiente').length;
    const otro_departamento = records.filter((r) => r.status === 'otro_departamento').length;
    const completionRate = total > 0 ? Math.round((realizado / total) * 1000) / 10 : 0;
    const duplicateRecords = records.filter((r) => r.is_duplicate).length;

    const monthMap = new Map<
      string,
      { total: number; realizado: number; pendiente: number; otro_departamento: number }
    >();
    const serviceMap = new Map<
      string,
      { total: number; realizado: number; pendiente: number; otro_departamento: number }
    >();
    const districtMap = new Map<string, { total: number; otro_departamento: number }>();

    for (const r of records) {
      const m = r.month_key || currentMonthKey();
      const mp = monthMap.get(m) || {
        total: 0,
        realizado: 0,
        pendiente: 0,
        otro_departamento: 0,
      };
      mp.total++;
      mp[r.status]++;
      monthMap.set(m, mp);

      const svc = r.servicio_figura || r.servicio_planilla || 'Sin especificar';
      const sp = serviceMap.get(svc) || {
        total: 0,
        realizado: 0,
        pendiente: 0,
        otro_departamento: 0,
      };
      sp.total++;
      sp[r.status]++;
      serviceMap.set(svc, sp);

      const dist = r.distrito || 'Sin especificar';
      const dp = districtMap.get(dist) || { total: 0, otro_departamento: 0 };
      dp.total++;
      if (r.status === 'otro_departamento') dp.otro_departamento++;
      districtMap.set(dist, dp);
    }

    const availableMonths = Array.from(monthMap.keys()).sort();
    const monthly: MonthlyMetricPoint[] = availableMonths.map((mk) => {
      const d = monthMap.get(mk)!;
      return {
        month_key: mk,
        label: formatMonthLabel(mk),
        total: d.total,
        realizado: d.realizado,
        pendiente: d.pendiente,
        otro_departamento: d.otro_departamento,
        completionRate: d.total > 0 ? Math.round((d.realizado / d.total) * 1000) / 10 : 0,
      };
    });

    const byService: ServiceBreakdownPoint[] = Array.from(serviceMap.entries())
      .map(([servicio, d]) => ({ servicio, ...d }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const byDistrict = Array.from(districtMap.entries())
      .map(([distrito, d]) => ({ distrito, ...d }))
      .sort((a, b) => b.total - a.total);

    const summary: AnalyticsSummary = {
      totals: {
        total,
        realizado,
        pendiente,
        otro_departamento,
        completionRate,
        duplicateRecords,
        duplicateClusters: clusters.length,
      },
      monthly,
      byService,
      byDistrict,
      availableMonths,
    };

    res.json(summary);
  });

  // Upload batches history
  app.get('/api/uploads', (_req: Request, res: Response) => {
    const uploads = db.prepare('SELECT * FROM uploads ORDER BY id DESC LIMIT 50').all();
    res.json({ uploads });
  });

  // Notifications
  app.get('/api/notifications', (_req: Request, res: Response) => {
    const items = db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 60').all();
    res.json({ notifications: items });
  });

  app.post('/api/notifications/read-all', (_req: Request, res: Response) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE is_read = 0').run();
    res.json({ ok: true });
  });

  // System logs
  app.get('/api/logs', (req: Request, res: Response) => {
    const level = typeof req.query.level === 'string' ? req.query.level : 'ALL';
    const category = typeof req.query.category === 'string' ? req.query.category : 'ALL';

    let sql = 'SELECT * FROM system_logs WHERE 1=1';
    const params: string[] = [];
    if (level !== 'ALL') {
      sql += ' AND level = ?';
      params.push(level);
    }
    if (category !== 'ALL') {
      sql += ' AND category = ?';
      params.push(category);
    }
    sql += ' ORDER BY id DESC LIMIT 200';

    const logs = db.prepare(sql).all(...params);
    res.json({ logs });
  });

  // Server real-time metrics + Monthly Server Performance Reports
  app.get('/api/metrics', (_req: Request, res: Response) => {
    res.json(getMetricsSnapshot());
  });

  app.get('/api/reports/monthly', (_req: Request, res: Response) => {
    const rows = db
      .prepare('SELECT * FROM monthly_server_metrics ORDER BY month_key DESC')
      .all() as Array<{
      month_key: string;
      total_requests: number;
      error_requests: number;
      total_latency_ms: number;
      max_latency_ms: number;
      peak_memory_mb: number;
      exports_generated: number;
      backups_created: number;
      last_updated: string;
    }>;

    const recordCountsByMonth = db
      .prepare('SELECT month_key, COUNT(*) AS cnt FROM records GROUP BY month_key')
      .all() as Array<{ month_key: string; cnt: number }>;
    const countMap = new Map(recordCountsByMonth.map((r) => [r.month_key, r.cnt]));

    const reports: MonthlyServerReport[] = rows.map((r) => {
      const avgLatency =
        r.total_requests > 0
          ? Math.round((r.total_latency_ms / r.total_requests) * 100) / 100
          : 0;
      const avail =
        r.total_requests > 0
          ? Math.round(((r.total_requests - r.error_requests) / r.total_requests) * 10000) / 100
          : 100;
      return {
        month_key: r.month_key,
        label: formatMonthLabel(r.month_key),
        total_requests: r.total_requests,
        error_requests: r.error_requests,
        availability_percent: avail,
        avg_latency_ms: avgLatency,
        max_latency_ms: Math.round(r.max_latency_ms * 100) / 100,
        peak_memory_mb: Math.round(r.peak_memory_mb * 100) / 100,
        records_processed: countMap.get(r.month_key) || 0,
        exports_generated: r.exports_generated,
        backups_created: r.backups_created,
        last_updated: r.last_updated,
      };
    });

    res.json({ reports });
  });

  app.get('/api/reports/monthly/export', (_req: Request, res: Response) => {
    const rows = db
      .prepare('SELECT * FROM monthly_server_metrics ORDER BY month_key DESC')
      .all() as Array<{
      month_key: string;
      total_requests: number;
      error_requests: number;
      total_latency_ms: number;
      max_latency_ms: number;
      peak_memory_mb: number;
      exports_generated: number;
      backups_created: number;
      last_updated: string;
    }>;

    const lines = [
      'Mes,Solicitudes Totales,Errores,Disponibilidad (%),Latencia Promedio (ms),Latencia Maxima (ms),Pico Memoria RSS (MB),Exportaciones Excel,Respaldos Generados,Ultima Actualizacion',
    ];

    for (const r of rows) {
      const avg =
        r.total_requests > 0 ? (r.total_latency_ms / r.total_requests).toFixed(2) : '0.00';
      const avail =
        r.total_requests > 0
          ? (((r.total_requests - r.error_requests) / r.total_requests) * 100).toFixed(2)
          : '100.00';
      lines.push(
        [
          r.month_key,
          r.total_requests,
          r.error_requests,
          avail,
          avg,
          r.max_latency_ms.toFixed(2),
          r.peak_memory_mb.toFixed(2),
          r.exports_generated,
          r.backups_created,
          r.last_updated,
        ].join(',')
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="informe_mensual_servidor_${currentMonthKey()}.csv"`
    );
    res.send('\uFEFF' + lines.join('\n'));
  });

  // Backups: list, create, download, restore
  app.get('/api/backups', (_req: Request, res: Response) => {
    const backups = db
      .prepare('SELECT id, created_at, label, record_count, size_bytes FROM backups ORDER BY id DESC')
      .all();
    res.json({ backups });
  });

  app.post('/api/backups', limitHeavy, (req: Request, res: Response) => {
    const label = String(req.body?.label || `Respaldo ${new Date().toLocaleDateString('es-ES')}`).trim();
    const records = db.prepare('SELECT * FROM records ORDER BY id ASC').all();
    const uploads = db.prepare('SELECT * FROM uploads ORDER BY id ASC').all();
    const now = new Date().toISOString();

    const payloadObj = {
      schemaVersion: 1,
      app: 'ResiControl',
      exportedAt: now,
      label,
      records,
      uploads,
    };
    const payload = JSON.stringify(payloadObj, null, 2);
    const sizeBytes = Buffer.byteLength(payload, 'utf8');

    const result = db
      .prepare('INSERT INTO backups (created_at, label, record_count, size_bytes, payload) VALUES (?, ?, ?, ?, ?)')
      .run(now, label, records.length, sizeBytes, payload);

    const mk = currentMonthKey();
    db.prepare(`
      INSERT INTO monthly_server_metrics (month_key, backups_created, last_updated)
      VALUES (?, 1, ?)
      ON CONFLICT(month_key) DO UPDATE SET
        backups_created = backups_created + 1,
        last_updated = excluded.last_updated
    `).run(mk, now);

    addSystemLog('INFO', 'BACKUP', `Respaldo local creado: "${label}" (${records.length} registros)`, {
      backupId: Number(result.lastInsertRowid),
      recordCount: records.length,
      sizeBytes,
    });
    addNotification(
      'backup_created',
      'Respaldo de base de datos listo',
      `Se generó el respaldo "${label}" con ${records.length} registros.`,
      { backupId: Number(result.lastInsertRowid) }
    );

    res.status(201).json({
      id: Number(result.lastInsertRowid),
      created_at: now,
      label,
      record_count: records.length,
      size_bytes: sizeBytes,
    });
  });

  app.get('/api/backups/:id/download', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }
    const backup = db.prepare('SELECT * FROM backups WHERE id = ?').get(id) as
      | { id: number; label: string; created_at: string; payload: string }
      | undefined;
    if (!backup) {
      res.status(404).json({ error: 'Respaldo no encontrado' });
      return;
    }

    const fname = `respaldo_resicontrol_${backup.created_at.slice(0, 10)}_${backup.id}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(backup.payload);
  });

  app.get('/api/backups/live-export', (_req: Request, res: Response) => {
    const records = db.prepare('SELECT * FROM records ORDER BY id ASC').all();
    const uploads = db.prepare('SELECT * FROM uploads ORDER BY id ASC').all();
    const now = new Date().toISOString();
    const payload = JSON.stringify(
      {
        schemaVersion: 1,
        app: 'ResiControl',
        exportedAt: now,
        label: 'Descarga directa completa',
        records,
        uploads,
      },
      null,
      2
    );

    const mk = currentMonthKey();
    db.prepare(`
      INSERT INTO monthly_server_metrics (month_key, backups_created, last_updated)
      VALUES (?, 1, ?)
      ON CONFLICT(month_key) DO UPDATE SET
        backups_created = backups_created + 1,
        last_updated = excluded.last_updated
    `).run(mk, now);

    addSystemLog('INFO', 'BACKUP', `Descarga directa de respaldo completo (${records.length} registros)`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="resicontrol_backup_${now.slice(0, 10)}.json"`
    );
    res.send(payload);
  });

  app.post('/api/backups/restore', limitHeavy, (req: Request, res: Response) => {
    const body = req.body as {
      mode?: 'merge' | 'replace';
      data?: { records?: Array<Partial<ResidenceRecord>> };
    };
    const records = body?.data?.records;
    if (!Array.isArray(records)) {
      res.status(400).json({ error: 'El archivo de respaldo no tiene un formato válido.' });
      return;
    }

    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    const validStatuses: RecordStatus[] = ['pendiente', 'realizado', 'otro_departamento'];
    const now = new Date().toISOString();

    const insertStmt = db.prepare(`
      INSERT INTO records (
        row_number, documento, documento_norm, codigo_nro, codigo_norm,
        nombres, apellidos, fecha_nacimiento, barrio_residencia,
        servicio_figura, servicio_corresponde, distrito, servicio_planilla,
        responsable, status, month_key, source_file, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec('BEGIN');
    try {
      if (mode === 'replace') {
        db.exec('DELETE FROM records;');
      }
      let restoredCount = 0;
      for (const r of records) {
        const doc = String(r.documento || '').trim();
        const cod = String(r.codigo_nro || '').trim();
        const nom = String(r.nombres || '').trim();
        const ape = String(r.apellidos || '').trim();
        if (!doc && !cod && !nom && !ape) continue;

        const st: RecordStatus = validStatuses.includes(r.status as RecordStatus)
          ? (r.status as RecordStatus)
          : 'pendiente';
        const mk = /^\d{4}-\d{2}$/.test(String(r.month_key || ''))
          ? String(r.month_key)
          : currentMonthKey();

        insertStmt.run(
          Number(r.row_number) || restoredCount + 1,
          doc,
          normalizeCode(doc),
          cod,
          normalizeCode(cod),
          nom,
          ape,
          String(r.fecha_nacimiento || '').trim(),
          String(r.barrio_residencia || '').trim(),
          String(r.servicio_figura || '').trim(),
          String(r.servicio_corresponde || '').trim(),
          String(r.distrito || '').trim(),
          String(r.servicio_planilla || '').trim(),
          String(r.responsable || '').trim(),
          st,
          mk,
          String(r.source_file || 'Restauración de Respaldo'),
          String(r.notes || '').trim(),
          String(r.created_at || now),
          now
        );
        restoredCount++;
      }
      db.exec('COMMIT');

      addSystemLog('INFO', 'BACKUP', `Respaldo restaurado en modo "${mode}" (${restoredCount} registros)`, {
        mode,
        restoredCount,
      });
      broadcastSse('data_changed', { reason: 'backup_restored', restoredCount });
      res.json({ ok: true, restored: restoredCount });
    } catch (err) {
      db.exec('ROLLBACK');
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Error al restaurar respaldo',
      });
    }
  });

  // Explicit user-triggered sample Excel load (useful for testing all features immediately)
  app.post('/api/demo-load', limitHeavy, (_req: Request, res: Response) => {
    const now = new Date().toISOString();
    const curMonth = currentMonthKey();
    const d = new Date();
    const prevDate1 = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    const prevDate2 = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 1));
    const m1 = `${prevDate1.getUTCFullYear()}-${String(prevDate1.getUTCMonth() + 1).padStart(2, '0')}`;
    const m2 = `${prevDate2.getUTCFullYear()}-${String(prevDate2.getUTCMonth() + 1).padStart(2, '0')}`;

    const sampleRows: Array<{
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
    }> = [
      {
        row_number: 1,
        documento: '6.421.890',
        codigo_nro: 'COD-1041',
        nombres: 'Mateo Alejandro',
        apellidos: 'Benítez Rojas',
        fecha_nacimiento: '14/03/2023',
        barrio_residencia: 'San Vicente',
        servicio_figura: 'USF Centro Norte',
        servicio_corresponde: 'USF San Vicente',
        distrito: 'Capital',
        servicio_planilla: 'USF San Vicente',
        responsable: 'Lic. Andrea Gómez',
        status: 'realizado',
        month_key: m2,
      },
      {
        row_number: 2,
        documento: '6.589.112',
        codigo_nro: 'COD-1042',
        nombres: 'Valentina Sofía',
        apellidos: 'Duarte Acosta',
        fecha_nacimiento: '22/07/2022',
        barrio_residencia: 'Las Mercedes',
        servicio_figura: 'Hospital Distrital Sur',
        servicio_corresponde: 'USF San Vicente',
        distrito: 'Capital',
        servicio_planilla: 'USF San Vicente',
        responsable: 'Lic. Andrea Gómez',
        status: 'realizado',
        month_key: m2,
      },
      {
        row_number: 3,
        documento: '6.712.304',
        codigo_nro: 'COD-1043',
        nombres: 'Thiago Gabriel',
        apellidos: 'Martínez Vera',
        fecha_nacimiento: '05/11/2024',
        barrio_residencia: 'Villa Aurelia',
        servicio_figura: 'USF San Vicente',
        servicio_corresponde: 'Hospital Regional Luque (Dpto. Central)',
        distrito: 'Capital',
        servicio_planilla: 'USF San Vicente',
        responsable: 'Lic. Andrea Gómez',
        status: 'otro_departamento',
        month_key: m1,
      },
      {
        row_number: 4,
        documento: '6.845.920',
        codigo_nro: 'COD-1044',
        nombres: 'Camila Belén',
        apellidos: 'Fernández Sosa',
        fecha_nacimiento: '19/01/2023',
        barrio_residencia: 'Sajonia',
        servicio_figura: 'USF Sajonia',
        servicio_corresponde: 'USF San Vicente',
        distrito: 'Capital',
        servicio_planilla: 'USF San Vicente',
        responsable: 'Lic. Andrea Gómez',
        status: 'realizado',
        month_key: m1,
      },
      {
        row_number: 5,
        documento: '6.933.410',
        codigo_nro: 'COD-1045',
        nombres: 'Lucas Sebastián',
        apellidos: 'Cabrera Franco',
        fecha_nacimiento: '30/09/2021',
        barrio_residencia: 'Loma Pytá',
        servicio_figura: 'USF San Vicente',
        servicio_corresponde: 'Centro de Salud Mariano Roque Alonso (Dpto. Central)',
        distrito: 'Capital',
        servicio_planilla: 'USF San Vicente',
        responsable: 'Lic. Andrea Gómez',
        status: 'otro_departamento',
        month_key: curMonth,
      },
      {
        row_number: 6,
        documento: '7.012.550',
        codigo_nro: 'COD-1046',
        nombres: 'Isabella Noemí',
        apellidos: 'Paredes Giménez',
        fecha_nacimiento: '12/05/2024',
        barrio_residencia: 'Pinozá',
        servicio_figura: 'Hospital Barrio Obrero',
        servicio_corresponde: 'USF San Vicente',
        distrito: 'Capital',
        servicio_planilla: 'USF San Vicente',
        responsable: 'Lic. Andrea Gómez',
        status: 'pendiente',
        month_key: curMonth,
      },
      {
        row_number: 7,
        documento: '6421890',
        codigo_nro: 'COD-1041',
        nombres: 'Mateo Alejandro',
        apellidos: 'Benitez Rojas',
        fecha_nacimiento: '14/03/2023',
        barrio_residencia: 'San Vicente',
        servicio_figura: 'USF Centro Norte',
        servicio_corresponde: 'USF San Vicente',
        distrito: 'Capital',
        servicio_planilla: 'USF San Vicente',
        responsable: 'Lic. Andrea Gómez',
        status: 'pendiente',
        month_key: curMonth,
      },
      {
        row_number: 8,
        documento: '7.105.224',
        codigo_nro: 'COD-1047',
        nombres: 'Joaquín Ignacio',
        apellidos: 'Núñez Ortiz',
        fecha_nacimiento: '08/08/2023',
        barrio_residencia: 'San Lorenzo Centro',
        servicio_figura: 'USF San Vicente',
        servicio_corresponde: 'Hospital Materno Infantil San Lorenzo (Dpto. Central)',
        distrito: 'Capital',
        servicio_planilla: 'USF San Vicente',
        responsable: 'Lic. Andrea Gómez',
        status: 'otro_departamento',
        month_key: curMonth,
      },
    ];

    const stmt = db.prepare(`
      INSERT INTO records (
        row_number, documento, documento_norm, codigo_nro, codigo_norm,
        nombres, apellidos, fecha_nacimiento, barrio_residencia,
        servicio_figura, servicio_corresponde, distrito, servicio_planilla,
        responsable, status, month_key, source_file, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Planilla_Ejemplo_USF_San_Vicente.xlsx', '', ?, ?)
    `);

    db.exec('BEGIN');
    try {
      for (const r of sampleRows) {
        stmt.run(
          r.row_number,
          r.documento,
          normalizeCode(r.documento),
          r.codigo_nro,
          normalizeCode(r.codigo_nro),
          r.nombres,
          r.apellidos,
          r.fecha_nacimiento,
          r.barrio_residencia,
          r.servicio_figura,
          r.servicio_corresponde,
          r.distrito,
          r.servicio_planilla,
          r.responsable,
          r.status,
          r.month_key,
          now,
          now
        );
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const { clusters } = computeDuplicates();
    addSystemLog('INFO', 'IMPORT', 'Planilla de ejemplo cargada (8 registros, 1 par duplicado)', {
      count: sampleRows.length,
    });
    addNotification(
      'duplicate_alert',
      'Duplicado detectado en planilla de ejemplo',
      `Se detectó 1 grupo duplicado (Doc: 6.421.890 / Mateo Alejandro Benítez Rojas) para que pueda probar la depuración.`,
      { clusters: clusters.length }
    );
    broadcastSse('data_changed', { reason: 'demo_loaded' });
    res.json({ ok: true, count: sampleRows.length });
  });

  // Download complete local package (.zip) with Windows/Mac/Linux launchers
  app.get('/api/download-local', limitHeavy, (_req: Request, res: Response) => {
    const crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
    const crc32 = (buf: Buffer): number => {
      let crc = 0xffffffff;
      for (let i = 0; i < buf.length; i++) {
        crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
      }
      return (crc ^ 0xffffffff) >>> 0;
    };

    const zipEntries: Array<{ name: string; data: Buffer; executable?: boolean }> = [];
    const allowedTopEntries = [
      'package.json',
      '.npmrc',
      'index.html',
      'tsconfig.json',
      'vite.config.ts',
      'server.ts',
      'README.md',
      'Dockerfile',
      '.env.example',
      '.gitignore',
      'metadata.json',
      'src',
      'public',
      '.github',
      'dist',
    ];

    const collectFiles = (relPath: string) => {
      const full = path.resolve(ROOT_DIR, relPath);
      if (full !== ROOT_DIR && !full.startsWith(ROOT_DIR + path.sep)) return;
      if (!fs.existsSync(full)) return;
      const stat = fs.statSync(full);
      const posixRel = relPath.replace(/\\/g, '/');
      if (stat.isDirectory()) {
        const base = path.basename(full);
        if (['node_modules', 'data', '.git', 'dev-dist'].includes(base)) return;
        for (const child of fs.readdirSync(full)) {
          collectFiles(path.join(relPath, child));
        }
      } else if (stat.isFile()) {
        if (posixRel.startsWith('.env') && posixRel !== '.env.example') return;
        if (posixRel === '.local-url') return;
        if (posixRel.includes('public/assets/aistudio')) return;
        zipEntries.push({
          name: `ResiControl/${posixRel}`,
          data: fs.readFileSync(full),
        });
      }
    };

    for (const item of allowedTopEntries) {
      collectFiles(item);
    }

    const openBrowserScript = [
      "import fs from 'node:fs';",
      "import http from 'node:http';",
      "import { exec } from 'node:child_process';",
      '',
      'const readTargetUrl = () => {',
      '  try {',
      "    if (fs.existsSync('.local-url')) {",
      "      const val = fs.readFileSync('.local-url', 'utf8').trim();",
      '      if (val) return val;',
      '    }',
      '  } catch {}',
      "  return 'http://localhost:3000';",
      '};',
      '',
      'const openUrl = (url) => {',
      "  if (process.platform === 'win32') {",
      "    exec(`start \"\" \"${url}\"`);",
      "  } else if (process.platform === 'darwin') {",
      "    exec(`open \"${url}\"`);",
      '  } else {',
      "    exec(`xdg-open \"${url}\"`);",
      '  }',
      '};',
      '',
      'let attempts = 0;',
      'const timer = setInterval(() => {',
      '  attempts += 1;',
      '  const target = readTargetUrl();',
      '  let port = 3000;',
      '  try {',
      '    port = Number(new URL(target).port) || 3000;',
      '  } catch {}',
      '  const req = http.get(',
      "    { hostname: '127.0.0.1', port, path: '/api/health', timeout: 1000 },",
      '    (res) => {',
      '      res.resume();',
      '      if (res.statusCode === 200) {',
      '        clearInterval(timer);',
      '        openUrl(target);',
      '      }',
      '    }',
      '  );',
      '  req.on(\'error\', () => {});',
      '  if (attempts >= 90) clearInterval(timer);',
      '}, 500);',
    ].join('\n');

    const winBat = [
      '@echo off',
      'setlocal EnableExtensions',
      'chcp 65001 >nul',
      'cd /d "%~dp0"',
      'title ResiControl - Servidor Local',
      '',
      'echo ==================================================',
      'echo   ResiControl - Iniciando Servidor Local',
      'echo ==================================================',
      'echo.',
      '',
      'where node >nul 2>nul',
      'if %errorlevel% neq 0 (',
      '  echo [ERROR] Necesita instalar Node.js v18, v20 o v22+ desde https://nodejs.org',
      '  pause',
      '  exit /b 1',
      ')',
      '',
      'for /f "delims=" %%v in (\'node -p "process.versions.node.split(\'.\')[0]"\') do set NODE_MAJOR=%%v',
      'if %NODE_MAJOR% LSS 18 (',
      '  echo [ERROR] Su version de Node.js ^(%NODE_MAJOR%^) es muy antigua.',
      '  echo Descargue Node.js LTS desde https://nodejs.org',
      '  pause',
      '  exit /b 1',
      ')',
      '',
      'set "NEED_INSTALL=0"',
      'if not exist "node_modules\\express" set "NEED_INSTALL=1"',
      'if not exist "node_modules\\.bin\\tsx.cmd" set "NEED_INSTALL=1"',
      'if not exist "node_modules\\sql.js" set "NEED_INSTALL=1"',
      'if not exist "node_modules\\exceljs" set "NEED_INSTALL=1"',
      'if not exist "node_modules\\xlsx" set "NEED_INSTALL=1"',
      '',
      'if "%NEED_INSTALL%"=="1" (',
      '  echo Instalando dependencias necesarias ^(solo la primera vez^)...',
      '  set "NODE_ENV="',
      '  call npm install --include=dev --legacy-peer-deps --no-audit --no-fund',
      '  if errorlevel 1 (',
      '    echo Reintentando instalacion limpia de dependencias...',
      '    call npm install --include=dev --force --no-audit --no-fund',
      '  )',
      '  if errorlevel 1 (',
      '    echo.',
      '    echo [ERROR] No se pudieron instalar las dependencias.',
      '    echo Verifique su conexion a internet e intente nuevamente.',
      '    pause',
      '    exit /b 1',
      '  )',
      ')',
      '',
      'if not exist "dist\\index.html" (',
      '  echo Compilando aplicacion por primera vez...',
      '  set "NODE_ENV="',
      '  call npm run build',
      '  if errorlevel 1 (',
      '    echo.',
      '    echo [ERROR] Fallo la compilacion de la aplicacion.',
      '    pause',
      '    exit /b 1',
      '  )',
      ')',
      '',
      'if exist ".local-url" del /f /q ".local-url" >nul 2>nul',
      'echo Iniciando servidor local...',
      'start "" /b node open-browser.mjs',
      '',
      'set "NODE_ENV=production"',
      'set "RESICONTROL_LOCAL=1"',
      'if exist "node_modules\\.bin\\tsx.cmd" (',
      '  call "node_modules\\.bin\\tsx.cmd" server.ts',
      ') else (',
      '  node server.ts',
      ')',
      '',
      'if errorlevel 1 (',
      '  echo.',
      '  echo [ERROR] El servidor se detuvo con errores.',
      '  pause',
      ')',
    ].join('\r\n');

    const shScript = [
      '#!/usr/bin/env bash',
      'set -e',
      'cd "$(dirname "$0")"',
      'if ! command -v node >/dev/null 2>&1; then',
      '  echo "[ERROR] Instale Node.js v18, v20 o v22+ desde https://nodejs.org"',
      '  exit 1',
      'fi',
      'NODE_MAJOR=$(node -p "process.versions.node.split(\'.\')[0]")',
      'if [ "$NODE_MAJOR" -lt 18 ]; then',
      '  echo "[ERROR] Su version de Node.js ($NODE_MAJOR) es muy antigua. Instale Node.js LTS desde https://nodejs.org"',
      '  exit 1',
      'fi',
      'if [ ! -d "node_modules/express" ] || [ ! -x "./node_modules/.bin/tsx" ] || [ ! -d "node_modules/sql.js" ] || [ ! -d "node_modules/exceljs" ]; then',
      '  echo "Instalando dependencias por primera vez..."',
      '  NODE_ENV= npm install --include=dev --legacy-peer-deps --no-audit --no-fund || NODE_ENV= npm install --include=dev --force --no-audit --no-fund',
      'fi',
      'if [ ! -f "dist/index.html" ]; then',
      '  echo "Compilando aplicacion por primera vez..."',
      '  NODE_ENV= npm run build',
      'fi',
      'rm -f .local-url',
      'echo "Iniciando ResiControl de manera local..."',
      'node open-browser.mjs &',
      'if [ -x "./node_modules/.bin/tsx" ]; then',
      '  NODE_ENV=production RESICONTROL_LOCAL=1 ./node_modules/.bin/tsx server.ts',
      'else',
      '  NODE_ENV=production RESICONTROL_LOCAL=1 node server.ts',
      'fi',
    ].join('\n');

    const guideTxt = [
      'RESICONTROL - INSTALACION LOCAL Y USO SIN INTERNET',
      '==================================================',
      '',
      'REQUISITO PREVIO (solo la primera vez):',
      '- Instalar Node.js LTS (v20, v22 o superior) desde https://nodejs.org',
      '',
      'EN WINDOWS:',
      '1. Descomprima TODO el archivo ZIP en una carpeta (ej. C:\\ResiControl).',
      '   (No ejecute INICIAR_WINDOWS.bat desde adentro del ZIP sin descomprimir).',
      '2. Haga doble clic en INICIAR_WINDOWS.bat',
      '3. La primera vez instalara las dependencias y abrira automaticamente el navegador.',
      '4. En los siguientes usos iniciara al instante y funcionara 100% sin internet.',
      '',
      'EN MAC / LINUX:',
      '1. Descomprima la carpeta y ejecute: chmod +x iniciar_mac_linux.sh && ./iniciar_mac_linux.sh',
      '',
      'INSTALACION COMO APP (PWA):',
      '- Una vez abierto en Chrome o Edge, puede instalarlo en su escritorio desde el boton',
      '  "Descargar e Instalar Local" -> "Instalar App Ahora".',
    ].join('\r\n');

    zipEntries.push({ name: 'ResiControl/open-browser.mjs', data: Buffer.from(openBrowserScript, 'utf8') });
    zipEntries.push({ name: 'ResiControl/INICIAR_WINDOWS.bat', data: Buffer.from(winBat, 'utf8') });
    zipEntries.push({ name: 'ResiControl/iniciar_mac_linux.sh', data: Buffer.from(shScript, 'utf8'), executable: true });
    zipEntries.push({ name: 'ResiControl/LEEME_INSTALACION.txt', data: Buffer.from(guideTxt, 'utf8') });

    const now = new Date();
    const dosTime =
      (((now.getHours() & 0x1f) << 11) |
        ((now.getMinutes() & 0x3f) << 5) |
        ((now.getSeconds() >> 1) & 0x1f)) >>>
      0;
    const dosDate =
      ((((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
        (((now.getMonth() + 1) & 0x0f) << 5) |
        (now.getDate() & 0x1f)) >>>
      0;

    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const entry of zipEntries) {
      const nameBuf = Buffer.from(entry.name, 'utf8');
      const compressed = zlib.deflateRawSync(entry.data);
      const crc = crc32(entry.data);

      const lfh = Buffer.alloc(30);
      lfh.writeUInt32LE(0x04034b50, 0);
      lfh.writeUInt16LE(20, 4);
      lfh.writeUInt16LE(0x0800, 6); // UTF-8 flag
      lfh.writeUInt16LE(8, 8); // deflate
      lfh.writeUInt16LE(dosTime, 10);
      lfh.writeUInt16LE(dosDate, 12);
      lfh.writeUInt32LE(crc >>> 0, 14);
      lfh.writeUInt32LE(compressed.length >>> 0, 18);
      lfh.writeUInt32LE(entry.data.length >>> 0, 22);
      lfh.writeUInt16LE(nameBuf.length, 26);
      lfh.writeUInt16LE(0, 28);

      localParts.push(lfh, nameBuf, compressed);

      const cdh = Buffer.alloc(46);
      cdh.writeUInt32LE(0x02014b50, 0);
      cdh.writeUInt16LE(entry.executable ? 0x0314 : 20, 4);
      cdh.writeUInt16LE(20, 6);
      cdh.writeUInt16LE(0x0800, 8);
      cdh.writeUInt16LE(8, 10);
      cdh.writeUInt16LE(dosTime, 12);
      cdh.writeUInt16LE(dosDate, 14);
      cdh.writeUInt32LE(crc >>> 0, 16);
      cdh.writeUInt32LE(compressed.length >>> 0, 20);
      cdh.writeUInt32LE(entry.data.length >>> 0, 24);
      cdh.writeUInt16LE(nameBuf.length, 28);
      cdh.writeUInt16LE(0, 30);
      cdh.writeUInt16LE(0, 32);
      cdh.writeUInt16LE(0, 34);
      cdh.writeUInt16LE(0, 36);
      cdh.writeUInt32LE(entry.executable ? (0o100755 << 16) >>> 0 : 0, 38);
      cdh.writeUInt32LE(offset >>> 0, 42);

      centralParts.push(cdh, nameBuf);
      offset += lfh.length + nameBuf.length + compressed.length;
    }

    const centralBuf = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(zipEntries.length, 8);
    eocd.writeUInt16LE(zipEntries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    const finalZip = Buffer.concat([...localParts, centralBuf, eocd]);
    addSystemLog('INFO', 'SYSTEM', 'Paquete instalador local ResiControl_Local.zip descargado', {
      files: zipEntries.length,
      sizeBytes: finalZip.length,
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="ResiControl_Local.zip"');
    res.send(finalZip);
  });

  // Boot log
  addSystemLog('INFO', 'SYSTEM', `Servidor ResiControl iniciado (${db.engine})`, {
    port: PORT,
    nodeVersion: process.version,
    dbEngine: db.engine,
  });

  // Vite dev middleware or static dist serving
  const distPath = path.resolve(ROOT_DIR, 'dist');
  const distIndex = path.join(distPath, 'index.html');
  if (IS_PROD && fs.existsSync(distIndex)) {
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(distIndex);
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const isLocalLaunch = process.env.RESICONTROL_LOCAL === '1' || !process.env.K_SERVICE;
  const checkExistingResiControl = (portToCheck: number): Promise<boolean> =>
    new Promise((resolve) => {
      const req = http.get(
        { hostname: '127.0.0.1', port: portToCheck, path: '/api/health', timeout: 800 },
        (resp) => {
          let raw = '';
          resp.on('data', (chunk) => {
            raw += chunk;
          });
          resp.on('end', () => {
            resolve(resp.statusCode === 200 && raw.includes('ResiControl'));
          });
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });

  const bindServer = (targetPort: number, forceIpv4Only = false): void => {
    const srv = http.createServer(app);
    srv.once('error', async (err: NodeJS.ErrnoException) => {
      if ((err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL') && !forceIpv4Only) {
        bindServer(targetPort, true);
        return;
      }
      if (err.code === 'EADDRINUSE' && isLocalLaunch) {
        const alreadyRunning = await checkExistingResiControl(targetPort);
        if (alreadyRunning) {
          const url = `http://localhost:${targetPort}`;
          try {
            fs.writeFileSync(path.resolve(ROOT_DIR, '.local-url'), url, 'utf8');
          } catch {}
          console.log(`ResiControl ya se encuentra ejecutándose en ${url}`);
          return;
        }
        if (targetPort < PORT + 20) {
          console.warn(`Puerto ${targetPort} en uso; intentando puerto ${targetPort + 1}...`);
          bindServer(targetPort + 1, forceIpv4Only);
          return;
        }
      }
      console.error('Fatal server listen error:', err);
      process.exit(1);
    });

    const onListening = () => {
      const url = `http://localhost:${targetPort}`;
      if (process.env.RESICONTROL_LOCAL === '1') {
        try {
          fs.writeFileSync(path.resolve(ROOT_DIR, '.local-url'), url, 'utf8');
        } catch {}
      }
      console.log(`ResiControl server listening on http://0.0.0.0:${targetPort} (${db.engine})`);
    };

    if (forceIpv4Only || !isLocalLaunch) {
      srv.listen(targetPort, '0.0.0.0', onListening);
    } else {
      srv.listen(targetPort, onListening);
    }
  };

  bindServer(PORT);
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
