import React, { useState, useRef } from 'react';
import {
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Download,
  X,
} from 'lucide-react';
import type { UploadBatch } from '../types';
import {
  previewExcelFile,
  importExcelData,
  downloadOfficialExcel,
} from '../lib/dataService';
import {
  DISTRICTS_CATALOG,
  getServicesForDistrict,
  matchCatalogSelection,
} from '../lib/districtsCatalog';

interface PreviewRow {
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
}

interface UploadPreview {
  filename: string;
  base64: string;
  distrito: string;
  servicio: string;
  responsable: string;
  totalRows: number;
  potentialDuplicates: number;
  rows: PreviewRow[];
}

interface UploadViewProps {
  uploads: UploadBatch[];
  onImportSuccess: () => Promise<void>;
  onNavigateDuplicates: () => void;
}

function getCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const UploadView: React.FC<UploadViewProps> = ({
  uploads,
  onImportSuccess,
  onNavigateDuplicates,
}) => {
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [monthKey, setMonthKey] = useState(getCurrentMonth());
  const [distritoOverride, setDistritoOverride] = useState('');
  const [servicioOverride, setServicioOverride] = useState('');
  const [responsableOverride, setResponsableOverride] = useState('');
  const [importResult, setImportResult] = useState<{
    imported: number;
    duplicatesDetected: number;
  } | null>(null);

  const availableServicesForSelected = React.useMemo(
    () => getServicesForDistrict(distritoOverride),
    [distritoOverride]
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setImportResult(null);
    setParsing(true);

    try {
      const data = await previewExcelFile(file);
      const matched = matchCatalogSelection(data.distrito || '', data.servicio || '');
      setPreview({
        filename: file.name,
        base64: data.base64,
        distrito: matched.distrito || data.distrito || '',
        servicio: matched.servicio || data.servicio || '',
        responsable: data.responsable || '',
        totalRows: data.totalRows || 0,
        potentialDuplicates: data.potentialDuplicates || 0,
        rows: data.rows || [],
      });
      setDistritoOverride(matched.distrito);
      setServicioOverride(matched.servicio);
      setResponsableOverride(data.responsable || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado leyendo el archivo');
    } finally {
      setParsing(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!preview) return;
    setImporting(true);
    setError(null);
    try {
      const data = await importExcelData({
        filename: preview.filename,
        base64: preview.base64,
        monthKey,
        distritoOverride,
        servicioOverride,
        responsableOverride,
        parsedRows: preview.rows,
      });
      setImportResult({
        imported: data.imported,
        duplicatesDetected: data.duplicatesDetected,
      });
      setPreview(null);
      await onImportSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la importación');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Action & Template Download */}
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Alzar Planilla de Excel (.xlsx, .xls, .csv)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Extrae automáticamente Distrito, Servicio, Responsable y cada casilla de la tabla de Cambio de Residencia.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              downloadOfficialExcel({
                records: [],
                statusFilter: 'all',
                monthFilter: 'all',
                template: true,
              })
            }
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Descargar Plantilla Vacía Oficial
          </button>
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            dragging
              ? 'border-teal-600 bg-teal-50/60'
              : 'border-slate-300 bg-slate-50/50 hover:border-teal-500 hover:bg-slate-50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
          <Upload className="w-8 h-8 text-teal-700 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-800">
            {parsing
              ? 'Analizando celdas y verificando duplicados...'
              : 'Arrastre aquí su archivo Excel o haga clic para seleccionarlo'}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Soporta planillas estándar de Cambio de Residencia hasta 15 MB
          </p>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {importResult && (
          <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
              <div className="text-xs text-emerald-950">
                <p className="font-semibold">
                  Se importaron {importResult.imported} registro(s) a la base de datos.
                </p>
                {importResult.duplicatesDetected > 0 && (
                  <p className="text-amber-800 mt-0.5 font-medium">
                    Aviso automático: {importResult.duplicatesDetected} fila(s) presentan coincidencia con registros existentes.
                  </p>
                )}
              </div>
            </div>
            {importResult.duplicatesDetected > 0 && (
              <button
                type="button"
                onClick={onNavigateDuplicates}
                className="px-3 py-1.5 bg-amber-700 text-white text-xs font-medium rounded-md hover:bg-amber-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Filtrar Duplicados
              </button>
            )}
          </div>
        )}
      </div>

      {/* Preview Table before Commit */}
      {preview && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <FileSpreadsheet className="w-5 h-5 text-teal-700" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Vista Previa: {preview.filename}
                </h3>
                <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                  {preview.totalRows} filas detectadas
                  {preview.potentialDuplicates > 0 && (
                    <span className="text-amber-700 font-medium">
                      {' '}
                      · {preview.potentialDuplicates} posible(s) duplicado(s)
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer self-start sm:self-center"
              aria-label="Cancelar vista previa"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Metadata confirmation */}
          <div className="p-6 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Distrito
              </label>
              <select
                value={distritoOverride}
                onChange={(e) => {
                  const nextDistrito = e.target.value;
                  setDistritoOverride(nextDistrito);
                  setServicioOverride('');
                }}
                className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="">Seleccione un distrito...</option>
                {DISTRICTS_CATALOG.map((entry) => (
                  <option key={entry.distrito} value={entry.distrito}>
                    {entry.distrito}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Servicio
              </label>
              <select
                value={servicioOverride}
                disabled={!distritoOverride}
                onChange={(e) => setServicioOverride(e.target.value)}
                className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-100 disabled:text-slate-400"
              >
                <option value="">
                  {distritoOverride
                    ? 'Seleccione un servicio...'
                    : 'Elija primero un distrito'}
                </option>
                {availableServicesForSelected.map((srv) => (
                  <option key={srv} value={srv}>
                    {srv}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Responsable
              </label>
              <input
                type="text"
                value={responsableOverride}
                onChange={(e) => setResponsableOverride(e.target.value)}
                placeholder="Ej: Lic. Andrea Gómez"
                className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Mes de Imputación
              </label>
              <input
                type="month"
                value={monthKey}
                onChange={(e) => setMonthKey(e.target.value)}
                className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md font-mono focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          {preview.potentialDuplicates > 0 && (
            <div className="px-6 py-3 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                Se detectaron <strong>{preview.potentialDuplicates}</strong> fila(s) coincidentes con registros ya existentes o repetidas en la misma planilla. Podrá depurarlas fácilmente tras importar.
              </span>
            </div>
          )}

          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                <tr>
                  <th className="px-3 py-2.5">N°</th>
                  <th className="px-3 py-2.5">Documento</th>
                  <th className="px-3 py-2.5">Código/Nro</th>
                  <th className="px-3 py-2.5">Nombres</th>
                  <th className="px-3 py-2.5">Apellidos</th>
                  <th className="px-3 py-2.5">F. Nacimiento</th>
                  <th className="px-3 py-2.5">Barrio Residencia</th>
                  <th className="px-3 py-2.5">Servicio Figura</th>
                  <th className="px-3 py-2.5">Servicio Corresponde</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.rows.slice(0, 100).map((r, idx) => (
                  <tr
                    key={idx}
                    className={r.potentialDuplicate ? 'bg-amber-50/70' : 'hover:bg-slate-50'}
                  >
                    <td className="px-3 py-2 font-mono tabular-nums text-slate-600">
                      {r.row_number}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums text-slate-900">
                      {r.documento}
                      {r.potentialDuplicate && (
                        <span className="ml-1.5 text-[11px] font-sans font-medium text-amber-700">
                          (Duplicado)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums text-slate-700">
                      {r.codigo_nro}
                    </td>
                    <td className="px-3 py-2 text-slate-900">{r.nombres}</td>
                    <td className="px-3 py-2 text-slate-900">{r.apellidos}</td>
                    <td className="px-3 py-2 font-mono tabular-nums text-slate-700">
                      {r.fecha_nacimiento}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{r.barrio_residencia}</td>
                    <td className="px-3 py-2 text-slate-700">{r.servicio_figura}</td>
                    <td className="px-3 py-2 text-slate-700">{r.servicio_corresponde}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4">
            <span className="text-xs text-slate-500">
              {!distritoOverride || !servicioOverride ? (
                <span className="text-amber-700 font-medium">
                  Seleccione Distrito y Servicio para poder importar la planilla.
                </span>
              ) : preview.rows.length > 100 ? (
                `Mostrando primeras 100 de ${preview.rows.length} filas`
              ) : (
                `Total: ${preview.rows.length} filas listas para guardar`
              )}
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={
                  importing ||
                  preview.rows.length === 0 ||
                  !distritoOverride ||
                  !servicioOverride
                }
                onClick={handleConfirmImport}
                className="px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                {importing
                  ? 'Importando...'
                  : `Importar ${preview.rows.length} Registros`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload History */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Historial de Planillas Cargadas
          </h3>
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            {uploads.length} carga(s)
          </span>
        </div>
        {uploads.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Todavía no se ha importado ninguna planilla Excel.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-6 py-3">Fecha y Hora</th>
                  <th className="px-4 py-3">Archivo</th>
                  <th className="px-4 py-3">Distrito / Servicio</th>
                  <th className="px-4 py-3">Responsable</th>
                  <th className="px-4 py-3 text-right">Filas</th>
                  <th className="px-6 py-3 text-right">Duplicados</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {uploads.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-mono tabular-nums text-slate-600">
                      {new Date(u.uploaded_at).toLocaleString('es-ES')}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{u.filename}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {u.distrito || '—'} · {u.servicio || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{u.responsable || '—'}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">
                      {u.total_rows}
                    </td>
                    <td className="px-6 py-3 text-right font-mono tabular-nums">
                      {u.duplicates_detected > 0 ? (
                        <span className="text-amber-700 font-medium">
                          {u.duplicates_detected} detectados
                        </span>
                      ) : (
                        <span className="text-emerald-700">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
