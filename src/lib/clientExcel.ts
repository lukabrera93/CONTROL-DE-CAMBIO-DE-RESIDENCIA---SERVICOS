import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import type {
  ResidenceRecord,
  DuplicateCluster,
  AnalyticsSummary,
  MonthlyMetricPoint,
  ServiceBreakdownPoint,
} from '../types';

export function normalizeCodeClient(val: string): string {
  return String(val || '')
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

export function normalizeTextClient(val: string): string {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatMonthLabelClient(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  const names = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const idx = Number(month) - 1;
  if (idx >= 0 && idx < 12) return `${names[idx]} ${year}`;
  return monthKey;
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

export interface ParsedExcelRow {
  row_number: number;
  documento: string;
  codigo_nro: string;
  nombres: string;
  apellidos: string;
  fecha_nacimiento: string;
  barrio_residencia: string;
  servicio_figura: string;
  servicio_corresponde: string;
}

export function parseWorkbookArrayBuffer(buffer: ArrayBuffer): {
  distrito: string;
  servicio: string;
  responsable: string;
  rows: ParsedExcelRow[];
} {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  let distrito = '';
  let servicio = '';
  let responsable = '';
  const allRows: ParsedExcelRow[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: true,
    });
    if (matrix.length === 0) continue;

    for (let r = 0; r < Math.min(8, matrix.length); r++) {
      const row = matrix[r] || [];
      for (let c = 0; c < row.length; c++) {
        const cellText = excelCellToString(row[c]);
        const norm = normalizeTextClient(cellText);
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
        const h = normalizeTextClient(excelCellToString(row[c]));
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

      if (
        !documento &&
        !codigo_nro &&
        !nombres &&
        !apellidos &&
        !fecha_nacimiento &&
        !barrio_residencia &&
        !servicio_figura &&
        !servicio_corresponde
      ) {
        continue;
      }

      const rawNum = Number(excelCellToString(getCol(colMap.row_number)));
      allRows.push({
        row_number: Number.isFinite(rawNum) && rawNum > 0 ? rawNum : allRows.length + 1,
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

export async function generateOfficialExcelClientBlob(params: {
  records: ResidenceRecord[];
  distrito?: string;
  servicio?: string;
  responsable?: string;
  minRows?: number;
}): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ResiControl';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Cambio de Residencia', {
    pageSetup: {
      paperSize: 9,
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
  const r1 = sheet.getRow(1);
  r1.height = 20;
  r1.getCell(1).value = 'DISTRITO:';
  r1.getCell(2).value = params.distrito ?? firstRec?.distrito ?? '';
  r1.getCell(3).value = 'SERVICIO:';
  r1.getCell(4).value = params.servicio ?? firstRec?.servicio_planilla ?? '';
  r1.getCell(5).value = 'RESPONSABLE:';
  r1.getCell(6).value = params.responsable ?? firstRec?.responsable ?? '';
  sheet.mergeCells('F1:I1');

  for (let c = 1; c <= 9; c++) {
    const cell = r1.getCell(c);
    cell.border = thinBorder;
    cell.font = { name: 'Calibri', size: 10, bold: c === 1 || c === 3 || c === 5 };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  }

  const r2 = sheet.getRow(2);
  r2.height = 22;
  sheet.mergeCells('A2:I2');
  r2.getCell(1).value = 'NIÑOS CON RESIDENCIA EN LA ZONA DE RESPONSABILIDAD';
  for (let c = 1; c <= 9; c++) {
    const cell = r2.getCell(c);
    cell.border = thinBorder;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }

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
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    cell.font = { name: 'Calibri', size: 9, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });

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

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function computeDuplicatesClient(records: ResidenceRecord[]): {
  annotated: ResidenceRecord[];
  clusters: DuplicateCluster[];
} {
  const n = records.length;
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
    if (ra !== rb) parent[rb] = ra;
    if (!reasonsByIndex.has(a)) reasonsByIndex.set(a, new Set());
    if (!reasonsByIndex.has(b)) reasonsByIndex.set(b, new Set());
    reasonsByIndex.get(a)!.add(reason);
    reasonsByIndex.get(b)!.add(reason);
  }

  const byDoc = new Map<string, number[]>();
  const byCode = new Map<string, number[]>();
  const byIdentity = new Map<string, number[]>();

  for (let i = 0; i < n; i++) {
    const r = records[i];
    const dNorm = normalizeCodeClient(r.documento);
    const cNorm = normalizeCodeClient(r.codigo_nro);
    if (dNorm.length >= 4) {
      const list = byDoc.get(dNorm) || [];
      list.push(i);
      byDoc.set(dNorm, list);
    }
    if (cNorm.length >= 3) {
      const list = byCode.get(cNorm) || [];
      list.push(i);
      byCode.set(cNorm, list);
    }
    const nNorm = normalizeTextClient(r.nombres);
    const aNorm = normalizeTextClient(r.apellidos);
    const fNorm = normalizeTextClient(r.fecha_nacimiento);
    if (nNorm && aNorm && fNorm) {
      const key = `${nNorm}|${aNorm}|${fNorm}`;
      const list = byIdentity.get(key) || [];
      list.push(i);
      byIdentity.set(key, list);
    }
  }

  for (const [, idxs] of byDoc) {
    if (idxs.length > 1) for (let k = 1; k < idxs.length; k++) union(idxs[0], idxs[k], 'Documento coincidente');
  }
  for (const [, idxs] of byCode) {
    if (idxs.length > 1) for (let k = 1; k < idxs.length; k++) union(idxs[0], idxs[k], 'Código/Nro coincidente');
  }
  for (const [, idxs] of byIdentity) {
    if (idxs.length > 1)
      for (let k = 1; k < idxs.length; k++) union(idxs[0], idxs[k], 'Nombre, apellido y fecha coincidentes');
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
        const row = records[idx];
        const rReasons = Array.from(reasonsByIndex.get(idx) || []);
        for (const reason of rReasons) clusterReasons.add(reason);
        duplicateMap.set(row.id, rReasons);
        clusterRecords.push({ ...row, is_duplicate: true, duplicate_reasons: rReasons });
      }
      const lead = clusterRecords[0];
      clusters.push({
        clusterId: `cluster-${root}`,
        matchKey: lead.documento || lead.codigo_nro || `${lead.nombres} ${lead.apellidos}`.trim(),
        reasons: Array.from(clusterReasons),
        records: clusterRecords,
      });
    }
  }

  const annotated = records.map((r) => {
    const reasons = duplicateMap.get(r.id);
    return {
      ...r,
      is_duplicate: Boolean(reasons && reasons.length > 0),
      duplicate_reasons: reasons || [],
    };
  });

  return { annotated, clusters };
}

export function computeAnalyticsClient(
  records: ResidenceRecord[],
  clusterCount: number
): AnalyticsSummary {
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
    const m = r.month_key || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const mp = monthMap.get(m) || { total: 0, realizado: 0, pendiente: 0, otro_departamento: 0 };
    mp.total++;
    mp[r.status]++;
    monthMap.set(m, mp);

    const svc = r.servicio_figura || r.servicio_planilla || 'Sin especificar';
    const sp = serviceMap.get(svc) || { total: 0, realizado: 0, pendiente: 0, otro_departamento: 0 };
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
      label: formatMonthLabelClient(mk),
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

  return {
    totals: {
      total,
      realizado,
      pendiente,
      otro_departamento,
      completionRate,
      duplicateRecords,
      duplicateClusters: clusterCount,
    },
    monthly,
    byService,
    byDistrict,
    availableMonths,
  };
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
