import React, { useState } from 'react';
import {
  AlertTriangle,
  Trash2,
  CheckCircle2,
  Sparkles,
  Edit3,
  Save,
  X,
} from 'lucide-react';
import type { DuplicateCluster, ResidenceRecord } from '../types';
import {
  deleteRecordEntry,
  updateRecordStatusOrFields,
  resolveDuplicatesBatch,
} from '../lib/dataService';

interface DuplicatesViewProps {
  clusters: DuplicateCluster[];
  onRefresh: () => Promise<void>;
}

export const DuplicatesView: React.FC<DuplicatesViewProps> = ({
  clusters,
  onRefresh,
}) => {
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<ResidenceRecord>>({});

  const handleDeleteOne = async (id: number) => {
    setBusy(true);
    try {
      await deleteRecordEntry(id);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleKeepOneInCluster = async (cluster: DuplicateCluster, keepId: number) => {
    setBusy(true);
    try {
      for (const rec of cluster.records) {
        if (rec.id !== keepId) {
          await deleteRecordEntry(rec.id);
        }
      }
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleResolveAll = async (keep: 'earliest' | 'latest') => {
    setBusy(true);
    try {
      await resolveDuplicatesBatch(keep);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleStartEdit = (rec: ResidenceRecord) => {
    setEditingId(rec.id);
    setEditDraft({
      documento: rec.documento,
      codigo_nro: rec.codigo_nro,
      nombres: rec.nombres,
      apellidos: rec.apellidos,
      fecha_nacimiento: rec.fecha_nacimiento,
      barrio_residencia: rec.barrio_residencia,
      servicio_figura: rec.servicio_figura,
      servicio_corresponde: rec.servicio_corresponde,
    });
  };

  const handleSaveEdit = async (id: number) => {
    setBusy(true);
    try {
      await updateRecordStatusOrFields(id, editDraft);
      setEditingId(null);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  if (clusters.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-10 text-center max-w-xl mx-auto mt-4">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
        <h2 className="text-base font-semibold text-slate-900">
          Sin registros duplicados
        </h2>
        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
          Todos los documentos, códigos y nombres registrados son únicos. El detector automático le notificará al instante si una nueva carga introduce entradas redundantes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Control Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {clusters.length} Grupo(s) de Registros Duplicados
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Compare entradas coincidentes para corregir datos erróneos o eliminar copias redundantes.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => handleResolveAll('earliest')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5 text-teal-700" />
            Depurar (Conservar Original)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => handleResolveAll('latest')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            Depurar (Conservar Más Reciente)
          </button>
        </div>
      </div>

      {/* Clusters */}
      <div className="space-y-4">
        {clusters.map((cluster) => (
          <div
            key={cluster.clusterId}
            className="bg-white border border-slate-200 rounded-lg overflow-hidden"
          >
            <div className="px-5 py-3 bg-amber-50/70 border-b border-amber-200 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium text-amber-950">
                Coincidencia: <span className="font-mono font-semibold">{cluster.matchKey}</span>
                <span className="text-amber-800 font-normal">
                  {' '}
                  · {cluster.reasons.join(' · ')}
                </span>
              </div>
              <span className="text-xs font-mono tabular-nums text-amber-800">
                {cluster.records.length} registros en conflicto
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5">ID</th>
                    <th className="px-3 py-2.5">Documento</th>
                    <th className="px-3 py-2.5">Código/Nro</th>
                    <th className="px-3 py-2.5">Nombres</th>
                    <th className="px-3 py-2.5">Apellidos</th>
                    <th className="px-3 py-2.5">F. Nacimiento</th>
                    <th className="px-3 py-2.5">Origen</th>
                    <th className="px-3 py-2.5">Estado</th>
                    <th className="px-4 py-2.5 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cluster.records.map((rec) => {
                    const isEditing = editingId === rec.id;
                    return (
                      <tr key={rec.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-mono tabular-nums text-slate-500">
                          #{rec.id}
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editDraft.documento ?? ''}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, documento: e.target.value }))
                              }
                              className="w-28 px-2 py-1 border border-slate-300 rounded text-xs"
                            />
                          ) : (
                            rec.documento || '—'
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editDraft.codigo_nro ?? ''}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, codigo_nro: e.target.value }))
                              }
                              className="w-24 px-2 py-1 border border-slate-300 rounded text-xs"
                            />
                          ) : (
                            rec.codigo_nro || '—'
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editDraft.nombres ?? ''}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, nombres: e.target.value }))
                              }
                              className="w-32 px-2 py-1 border border-slate-300 rounded text-xs"
                            />
                          ) : (
                            rec.nombres
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editDraft.apellidos ?? ''}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, apellidos: e.target.value }))
                              }
                              className="w-32 px-2 py-1 border border-slate-300 rounded text-xs"
                            />
                          ) : (
                            rec.apellidos
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editDraft.fecha_nacimiento ?? ''}
                              onChange={(e) =>
                                setEditDraft((d) => ({
                                  ...d,
                                  fecha_nacimiento: e.target.value,
                                }))
                              }
                              className="w-24 px-2 py-1 border border-slate-300 rounded text-xs"
                            />
                          ) : (
                            rec.fecha_nacimiento || '—'
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-500 max-w-44 truncate">
                          {rec.source_file} · {rec.month_key}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700 capitalize">
                          {rec.status.replace('_', ' ')}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleSaveEdit(rec.id)}
                                  className="px-2 py-1 bg-teal-700 text-white rounded hover:bg-teal-800 inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Save className="w-3 h-3" />
                                  Guardar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleStartEdit(rec)}
                                  className="px-2 py-1 bg-white border border-slate-300 text-slate-700 rounded hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  Corregir
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleKeepOneInCluster(cluster, rec.id)}
                                  className="px-2 py-1 bg-teal-50 border border-teal-200 text-teal-800 rounded hover:bg-teal-100 cursor-pointer whitespace-nowrap"
                                >
                                  Conservar solo este
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleDeleteOne(rec.id)}
                                  className="p-1 text-rose-600 hover:bg-rose-50 rounded cursor-pointer"
                                  title="Eliminar esta entrada redundante"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
