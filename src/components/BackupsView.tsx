import React, { useState, useRef } from 'react';
import {
  Download,
  Upload,
  HardDrive,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import type { BackupEntry, ResidenceRecord } from '../types';
import {
  downloadLocalBackupJson,
  downloadOfficialExcel,
  restoreBackupData,
} from '../lib/dataService';

interface BackupsViewProps {
  backups: BackupEntry[];
  records: ResidenceRecord[];
  onRefresh: () => Promise<void>;
}

export const BackupsView: React.FC<BackupsViewProps> = ({
  backups,
  records,
  onRefresh,
}) => {
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge');
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setMessage(null);
    try {
      const resp = await fetch('/api/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim() || `Respaldo Manual ${new Date().toLocaleDateString('es-ES')}`,
        }),
      });
      if (!resp.ok) throw new Error('Error al crear respaldo');
      setLabel('');
      setMessage({ type: 'ok', text: 'Punto de restauración guardado en el servidor.' });
      await onRefresh();
    } catch (err) {
      setMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Error al crear respaldo',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleRestoreFile = async (file: File) => {
    setRestoring(true);
    setMessage(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const data = await restoreBackupData(restoreMode, parsed);
      setMessage({
        type: 'ok',
        text: `Restauración completada (${data.restored} registros importados en modo ${
          restoreMode === 'replace' ? 'Reemplazo total' : 'Combinación'
        }${data.viaServer ? '' : ' en base local del navegador'}).`,
      });
      await onRefresh();
    } catch (err) {
      setMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Archivo de respaldo inválido',
      });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Quick Local Backup Downloads */}
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="text-base font-semibold text-slate-900">
          Respaldo Local y Exportación Maestra
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Descargue una copia local íntegra de toda la base de datos ({records.length} registros actuales) en formato JSON para restauración completa o en Excel consolidado, incluso sin internet.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => downloadLocalBackupJson(records)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Descargar Backup Local Completo (.json)
          </button>

          <button
            type="button"
            onClick={() =>
              downloadOfficialExcel({
                records,
                statusFilter: 'all',
                monthFilter: 'all',
              })
            }
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
            Descargar Planilla Maestra (.xlsx)
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`p-3.5 rounded-lg border text-xs flex items-center gap-2 ${
            message.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          {message.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Two-Column: Create Server Snapshot & Restore from Local File */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-2">
            <HardDrive className="w-4 h-4 text-teal-700" />
            <h3 className="text-sm font-semibold text-slate-900">
              Crear Snapshot en Servidor
            </h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Guarda un punto de recuperación histórico en la base de datos SQLite para descargarlo posteriormente.
          </p>
          <form onSubmit={handleCreateSnapshot} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Etiqueta del respaldo (ej: Cierre Noviembre)"
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              {creating ? 'Guardando...' : 'Guardar Snapshot'}
            </button>
          </form>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-2">
            <Upload className="w-4 h-4 text-teal-700" />
            <h3 className="text-sm font-semibold text-slate-900">
              Restaurar desde Backup Local (.json)
            </h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Recupere información desde un archivo de respaldo previamente descargado.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={restoreMode}
              onChange={(e) => setRestoreMode(e.target.value as 'merge' | 'replace')}
              className="px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg"
            >
              <option value="merge">Combinar con registros actuales</option>
              <option value="replace">Reemplazar toda la base actual</option>
            </select>
            <input
              ref={restoreInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleRestoreFile(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={restoring}
              onClick={() => restoreInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              {restoring ? 'Restaurando...' : 'Seleccionar Archivo .json'}
            </button>
          </div>
        </div>
      </div>

      {/* Stored Snapshots History */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Historial de Snapshots Guardados
          </h3>
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            {backups.length} respaldo(s)
          </span>
        </div>
        {backups.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Aún no hay snapshots guardados en el historial del servidor.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-6 py-3">Fecha de Creación</th>
                  <th className="px-4 py-3">Etiqueta</th>
                  <th className="px-4 py-3 text-right">Registros</th>
                  <th className="px-4 py-3 text-right">Tamaño</th>
                  <th className="px-6 py-3 text-right">Descargar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {backups.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-mono tabular-nums text-slate-600">
                      {new Date(b.created_at).toLocaleString('es-ES')}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{b.label}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">
                      {b.record_count}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                      {(b.size_bytes / 1024).toFixed(1)} KB
                    </td>
                    <td className="px-6 py-3 text-right">
                      <a
                        href={`/api/backups/${b.id}/download`}
                        className="inline-flex items-center gap-1 text-teal-700 font-medium hover:underline"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Descargar JSON
                      </a>
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
