import React, { useMemo, useState } from 'react';
import { Printer, X } from 'lucide-react';
import type { ResidenceRecord, UploadBatch } from '../types';
import { formatMonthLabelClient } from '../lib/clientExcel';

interface MonthlyReportPrintModalProps {
  open: boolean;
  onClose: () => void;
  records: ResidenceRecord[];
  uploads?: UploadBatch[];
  availableMonths: string[];
  initialMonth?: string;
}

export const MonthlyReportPrintModal: React.FC<MonthlyReportPrintModalProps> = ({
  open,
  onClose,
  records,
  uploads = [],
  availableMonths,
  initialMonth,
}) => {
  const [selectedMonth, setSelectedMonth] = useState<string>(
    initialMonth || availableMonths[availableMonths.length - 1] || 'all'
  );
  const [distritoFilter, setDistritoFilter] = useState<string>('all');
  const [servicioFilter, setServicioFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [includeNominalList, setIncludeNominalList] = useState(true);
  const [onlyOtroDeptoList, setOnlyOtroDeptoList] = useState(false);

  const availableDistritos = useMemo(() => {
    const set = new Set<string>();
    for (const u of uploads) {
      const val = (u.distrito || '').trim();
      if (val) set.add(val);
    }
    for (const r of records) {
      const val = (r.distrito || '').trim();
      if (val) set.add(val);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [records, uploads]);

  const availableServicios = useMemo(() => {
    const set = new Set<string>();
    for (const u of uploads) {
      if (distritoFilter !== 'all' && (u.distrito || '').trim() !== distritoFilter) continue;
      const val = (u.servicio || '').trim();
      if (val) set.add(val);
    }
    for (const r of records) {
      if (distritoFilter !== 'all' && (r.distrito || '').trim() !== distritoFilter) continue;
      const val = (r.servicio_planilla || '').trim();
      if (val) set.add(val);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [records, uploads, distritoFilter]);

  const defaultResponsable = useMemo(() => records[0]?.responsable || '', [records]);

  const [responsable, setResponsable] = useState(defaultResponsable);
  const [observaciones, setObservaciones] = useState('');

  const scopedRecords = useMemo(() => {
    return records.filter((r) => {
      if (selectedMonth !== 'all' && r.month_key !== selectedMonth) return false;
      if (distritoFilter !== 'all' && r.distrito !== distritoFilter) return false;
      if (servicioFilter !== 'all' && r.servicio_planilla !== servicioFilter) {
        return false;
      }
      const createdDate = (r.created_at || '').slice(0, 10);
      if (dateFrom && createdDate < dateFrom) return false;
      if (dateTo && createdDate > dateTo) return false;
      return true;
    });
  }, [records, selectedMonth, distritoFilter, servicioFilter, dateFrom, dateTo]);

  const stats = useMemo(() => {
    const total = scopedRecords.length;
    const realizado = scopedRecords.filter((r) => r.status === 'realizado').length;
    const pendiente = scopedRecords.filter((r) => r.status === 'pendiente').length;
    const otroDepto = scopedRecords.filter((r) => r.status === 'otro_departamento').length;
    const duplicados = scopedRecords.filter((r) => r.is_duplicate).length;
    const pctRealizado = total > 0 ? Math.round((realizado / total) * 1000) / 10 : 0;
    const pctPendiente = total > 0 ? Math.round((pendiente / total) * 1000) / 10 : 0;
    const pctOtro = total > 0 ? Math.round((otroDepto / total) * 1000) / 10 : 0;

    const svcMap = new Map<
      string,
      {
        distrito: string;
        servicio: string;
        total: number;
        realizado: number;
        pendiente: number;
        otroDepto: number;
      }
    >();
    for (const r of scopedRecords) {
      const distrito = (r.distrito || '').trim() || 'Sin especificar';
      const servicio = (r.servicio_planilla || '').trim() || 'Sin especificar';
      const key = `${distrito}|||${servicio}`;
      const entry = svcMap.get(key) || {
        distrito,
        servicio,
        total: 0,
        realizado: 0,
        pendiente: 0,
        otroDepto: 0,
      };
      entry.total++;
      if (r.status === 'realizado') entry.realizado++;
      else if (r.status === 'pendiente') entry.pendiente++;
      else entry.otroDepto++;
      svcMap.set(key, entry);
    }

    const byService = Array.from(svcMap.entries())
      .map(([key, val]) => ({
        key,
        ...val,
        pct: val.total > 0 ? Math.round((val.realizado / val.total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => {
        const dCmp = a.distrito.localeCompare(b.distrito, 'es');
        if (dCmp !== 0) return dCmp;
        return a.servicio.localeCompare(b.servicio, 'es');
      });

    return {
      total,
      realizado,
      pendiente,
      otroDepto,
      duplicados,
      pctRealizado,
      pctPendiente,
      pctOtro,
      byService,
    };
  }, [scopedRecords]);

  const printableRows = useMemo(() => {
    if (onlyOtroDeptoList) {
      return scopedRecords.filter((r) => r.status === 'otro_departamento');
    }
    return scopedRecords;
  }, [scopedRecords, onlyOtroDeptoList]);

  if (!open) return null;

  const periodTitle =
    selectedMonth === 'all' ? 'Acumulado General' : formatMonthLabelClient(selectedMonth);

  const statusText = (s: string) => {
    if (s === 'realizado') return 'Realizado';
    if (s === 'otro_departamento') return 'De otro departamento';
    return 'Pendiente';
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center p-0 sm:p-4 overflow-y-auto print:static print:bg-white print:p-0">
      <div className="bg-white border border-slate-200 sm:rounded-lg max-w-4xl w-full my-0 sm:my-4 overflow-hidden print-only-sheet">
        {/* Controls Toolbar (hidden on print) */}
        <div className="no-print px-6 py-4 bg-slate-50 border-b border-slate-200 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Informe Mensual de Avance (Vista de Impresión)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Seleccione los filtros y el responsable antes de imprimir o guardar en PDF. Funciona sin internet.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 cursor-pointer whitespace-nowrap"
              >
                <Printer className="w-4 h-4" />
                Imprimir / Guardar PDF
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-2 text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
                aria-label="Cerrar vista de impresión"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Periodo / Mes
              </label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono"
              >
                <option value="all">Acumulado General (Todos)</option>
                {availableMonths.map((m) => (
                  <option key={m} value={m}>
                    {formatMonthLabelClient(m)} ({m})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Filtrar por Distrito
              </label>
              <select
                value={distritoFilter}
                onChange={(e) => {
                  setDistritoFilter(e.target.value);
                  setServicioFilter('all');
                }}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              >
                <option value="all">Todos los distritos</option>
                {availableDistritos.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Filtrar por Servicio
              </label>
              <select
                value={servicioFilter}
                onChange={(e) => setServicioFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              >
                <option value="all">Todos los servicios</option>
                {availableServicios.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Responsable
              </label>
              <input
                type="text"
                value={responsable}
                onChange={(e) => setResponsable(e.target.value)}
                placeholder={defaultResponsable || 'Nombre del responsable'}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Fecha desde
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Fecha hasta
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium text-slate-600">
                Detalle nominal:
              </span>
              <div
                className="inline-flex rounded-md border border-slate-300 bg-white overflow-hidden"
                role="group"
                aria-label="Incluir detalle nominal en el informe"
              >
                <button
                  type="button"
                  onClick={() => setIncludeNominalList(true)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                    includeNominalList
                      ? 'bg-teal-700 text-white'
                      : 'bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Con detalle nominal
                </button>
                <button
                  type="button"
                  onClick={() => setIncludeNominalList(false)}
                  className={`px-3 py-1.5 text-xs font-medium border-l border-slate-300 transition-colors cursor-pointer ${
                    !includeNominalList
                      ? 'bg-teal-700 text-white'
                      : 'bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Sin detalle nominal (solo resumen)
                </button>
              </div>
            </div>

            {includeNominalList && (
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyOtroDeptoList}
                  onChange={(e) => setOnlyOtroDeptoList(e.target.checked)}
                />
                <span>Listar solo casos "De otro departamento"</span>
              </label>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Observaciones / Notas del Informe (opcional)
            </label>
            <input
              type="text"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Ej: Se remitieron las planillas de otro departamento por correo institucional..."
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
            />
          </div>
        </div>

        {/* Printable Institutional Sheet */}
        <div className="p-8 space-y-6 text-slate-900 bg-white">
          {/* Report Header */}
          <div className="border-b-2 border-slate-900 pb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <div className="text-xs font-semibold tracking-wide text-teal-800 uppercase">
                ResiControl · Informe Mensual de Avance
              </div>
              <h1 className="text-xl font-bold text-slate-900 mt-1">
                Niños con Residencia en la Zona de Responsabilidad
              </h1>
            </div>
            <div className="text-xs text-slate-600 font-mono tabular-nums sm:text-right">
              <div>Periodo: {periodTitle}</div>
              <div>Emisión: {new Date().toLocaleDateString('es-ES')}</div>
            </div>
          </div>

          {/* Institutional Metadata Strip */}
          <div className="grid grid-cols-3 border border-slate-300 text-xs">
            <div className="p-2.5 border-r border-slate-300">
              <span className="font-semibold text-slate-600">DISTRITO: </span>
              <span className="text-slate-900">
                {distritoFilter === 'all' ? 'Todos' : distritoFilter}
              </span>
            </div>
            <div className="p-2.5 border-r border-slate-300">
              <span className="font-semibold text-slate-600">SERVICIO: </span>
              <span className="text-slate-900">
                {servicioFilter === 'all' ? 'Todos' : servicioFilter}
              </span>
            </div>
            <div className="p-2.5">
              <span className="font-semibold text-slate-600">RESPONSABLE: </span>
              <span className="text-slate-900">
                {responsable || defaultResponsable || '—'}
              </span>
            </div>
          </div>

          {/* KPI Summary Grid */}
          <div className="grid grid-cols-4 gap-3 print-avoid-break">
            <div className="border border-slate-300 p-3">
              <div className="text-[11px] font-medium text-slate-500">Total Evaluados</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {stats.total}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
                {stats.duplicados} duplicado(s)
              </div>
            </div>
            <div className="border border-slate-300 p-3">
              <div className="text-[11px] font-medium text-emerald-800">Realizados</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                {stats.realizado}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-emerald-800 mt-0.5">
                {stats.pctRealizado}% del total
              </div>
            </div>
            <div className="border border-slate-300 p-3">
              <div className="text-[11px] font-medium text-amber-800">Pendientes</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">
                {stats.pendiente}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-amber-800 mt-0.5">
                {stats.pctPendiente}% del total
              </div>
            </div>
            <div className="border border-slate-300 p-3">
              <div className="text-[11px] font-medium text-rose-800">De otro departamento</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-rose-700 mt-1">
                {stats.otroDepto}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-rose-800 mt-0.5">
                {stats.pctOtro}% del total
              </div>
            </div>
          </div>

          {/* Visual Stacked Progress Bar */}
          <div className="print-avoid-break">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-semibold text-slate-700">Distribución de Avance</span>
              <span className="font-mono tabular-nums text-slate-600">
                Cumplimiento: {stats.pctRealizado}%
              </span>
            </div>
            <div className="w-full h-3 bg-slate-100 border border-slate-300 flex overflow-hidden">
              {stats.pctRealizado > 0 && (
                <div
                  className="bg-emerald-600 h-full"
                  style={{ width: `${stats.pctRealizado}%` }}
                />
              )}
              {stats.pctPendiente > 0 && (
                <div
                  className="bg-amber-500 h-full"
                  style={{ width: `${stats.pctPendiente}%` }}
                />
              )}
              {stats.pctOtro > 0 && (
                <div
                  className="bg-rose-600 h-full"
                  style={{ width: `${stats.pctOtro}%` }}
                />
              )}
            </div>
          </div>

          {/* Breakdown by Loaded District and Service */}
          <div className="print-avoid-break">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700 mb-2">
              Desglose por Distrito y Servicio Cargado
            </h3>
            <table className="w-full text-left text-xs border-collapse border border-slate-300">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-3 py-2">Distrito</th>
                  <th className="border border-slate-300 px-3 py-2">Servicio</th>
                  <th className="border border-slate-300 px-3 py-2 text-right">Total</th>
                  <th className="border border-slate-300 px-3 py-2 text-right">Realizado</th>
                  <th className="border border-slate-300 px-3 py-2 text-right">Pendiente</th>
                  <th className="border border-slate-300 px-3 py-2 text-right">Otro Dpto.</th>
                  <th className="border border-slate-300 px-3 py-2 text-right">% Avance</th>
                </tr>
              </thead>
              <tbody>
                {stats.byService.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="border border-slate-300 px-3 py-4 text-center text-slate-500"
                    >
                      Sin registros para el periodo seleccionado.
                    </td>
                  </tr>
                ) : (
                  stats.byService.map((svc) => (
                    <tr key={svc.key}>
                      <td className="border border-slate-300 px-3 py-1.5 font-medium">
                        {svc.distrito}
                      </td>
                      <td className="border border-slate-300 px-3 py-1.5 font-medium">
                        {svc.servicio}
                      </td>
                      <td className="border border-slate-300 px-3 py-1.5 text-right font-mono tabular-nums">
                        {svc.total}
                      </td>
                      <td className="border border-slate-300 px-3 py-1.5 text-right font-mono tabular-nums">
                        {svc.realizado}
                      </td>
                      <td className="border border-slate-300 px-3 py-1.5 text-right font-mono tabular-nums">
                        {svc.pendiente}
                      </td>
                      <td className="border border-slate-300 px-3 py-1.5 text-right font-mono tabular-nums">
                        {svc.otroDepto}
                      </td>
                      <td className="border border-slate-300 px-3 py-1.5 text-right font-mono tabular-nums font-semibold">
                        {svc.pct}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Optional Nominal Detail Table */}
          {includeNominalList && printableRows.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700 mb-2">
                {onlyOtroDeptoList
                  ? `Detalle Nominal — De Otro Departamento (${printableRows.length})`
                  : `Detalle Nominal del Periodo (${printableRows.length})`}
              </h3>
              <table className="w-full text-left text-[11px] border-collapse border border-slate-300">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-300 px-2 py-1.5">N°</th>
                    <th className="border border-slate-300 px-2 py-1.5">Documento</th>
                    <th className="border border-slate-300 px-2 py-1.5">Nombres y Apellidos</th>
                    <th className="border border-slate-300 px-2 py-1.5">F. Nac.</th>
                    <th className="border border-slate-300 px-2 py-1.5">Barrio</th>
                    <th className="border border-slate-300 px-2 py-1.5">Servicio Corresponde</th>
                    <th className="border border-slate-300 px-2 py-1.5">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {printableRows.map((r, idx) => (
                    <tr key={r.id} className="print-avoid-break">
                      <td className="border border-slate-300 px-2 py-1 font-mono tabular-nums text-center">
                        {idx + 1}
                      </td>
                      <td className="border border-slate-300 px-2 py-1 font-mono tabular-nums">
                        {r.documento || r.codigo_nro || '—'}
                      </td>
                      <td className="border border-slate-300 px-2 py-1">
                        {r.nombres} {r.apellidos}
                      </td>
                      <td className="border border-slate-300 px-2 py-1 font-mono tabular-nums">
                        {r.fecha_nacimiento || '—'}
                      </td>
                      <td className="border border-slate-300 px-2 py-1">
                        {r.barrio_residencia || '—'}
                      </td>
                      <td className="border border-slate-300 px-2 py-1">
                        {r.servicio_corresponde || '—'}
                      </td>
                      <td className="border border-slate-300 px-2 py-1 font-medium">
                        {statusText(r.status)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {observaciones.trim() && (
            <div className="border border-slate-300 p-3 text-xs print-avoid-break">
              <div className="font-semibold text-slate-700 mb-1">Observaciones:</div>
              <p className="text-slate-800">{observaciones}</p>
            </div>
          )}

          {/* Signature Footer */}
          <div className="pt-10 grid grid-cols-2 gap-12 text-center text-xs print-avoid-break">
            <div>
              <div className="border-t border-slate-800 pt-2 font-medium text-slate-800">
                {responsable || defaultResponsable || 'Responsable del Servicio'}
              </div>
              <div className="text-[11px] text-slate-500">Firma y Sello</div>
            </div>
            <div>
              <div className="border-t border-slate-800 pt-2 font-medium text-slate-800">
                Supervisión / Coordinación Distrital
              </div>
              <div className="text-[11px] text-slate-500">Recepción y Control</div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 text-center text-[11px] text-slate-500">
            © {new Date().getFullYear()} ResiControl · Desarrollado por Lucio Pastor Cabrera Olmedo. Todos los derechos reservados.
          </div>
        </div>
      </div>
    </div>
  );
};
