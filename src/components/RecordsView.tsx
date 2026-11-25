import React, { useState, useMemo } from 'react';
import {
  Search,
  CheckCircle2,
  Clock,
  ArrowRightLeft,
  Download,
  Mail,
  Plus,
  Edit3,
  Trash2,
  AlertTriangle,
  X,
  Copy,
  Check,
} from 'lucide-react';
import type { ResidenceRecord, RecordStatus } from '../types';

interface RecordsViewProps {
  records: ResidenceRecord[];
  availableMonths: string[];
  statusFilter: RecordStatus | 'all' | 'duplicates';
  onStatusFilterChange: (val: RecordStatus | 'all' | 'duplicates') => void;
  onRefresh: () => Promise<void>;
  onNavigateDuplicates: () => void;
}

const EMPTY_FORM: Partial<ResidenceRecord> = {
  documento: '',
  codigo_nro: '',
  nombres: '',
  apellidos: '',
  fecha_nacimiento: '',
  barrio_residencia: '',
  servicio_figura: '',
  servicio_corresponde: '',
  distrito: '',
  servicio_planilla: '',
  responsable: '',
  status: 'pendiente',
  month_key: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
};

export const RecordsView: React.FC<RecordsViewProps> = ({
  records,
  availableMonths,
  statusFilter,
  onStatusFilterChange,
  onRefresh,
  onNavigateDuplicates,
}) => {
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Add / Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ResidenceRecord | null>(null);
  const [formData, setFormData] = useState<Partial<ResidenceRecord>>(EMPTY_FORM);
  const [formSaving, setFormSaving] = useState(false);

  // Email & Custom Excel Export modal
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [exportDistrito, setExportDistrito] = useState('');
  const [exportServicio, setExportServicio] = useState('');
  const [exportResponsable, setExportResponsable] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [copiedSummary, setCopiedSummary] = useState(false);

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (statusFilter === 'duplicates') {
        if (!r.is_duplicate) return false;
      } else if (statusFilter !== 'all') {
        if (r.status !== statusFilter) return false;
      }
      if (monthFilter !== 'all' && r.month_key !== monthFilter) {
        return false;
      }
      if (q) {
        const hay = `${r.documento} ${r.codigo_nro} ${r.nombres} ${r.apellidos} ${r.barrio_residencia} ${r.servicio_figura} ${r.servicio_corresponde} ${r.distrito} ${r.responsable}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, statusFilter, monthFilter, search]);

  const otroDeptoCount = useMemo(
    () => records.filter((r) => r.status === 'otro_departamento').length,
    [records]
  );

  const handleStatusChange = async (id: number, status: RecordStatus) => {
    setBusyId(id);
    try {
      await fetch(`/api/records/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleBulkStatus = async (status: RecordStatus) => {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      await fetch('/api/records/bulk-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds, status }),
      });
      setSelectedIds([]);
      await onRefresh();
    } finally {
      setBulkBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    setBusyId(id);
    try {
      await fetch(`/api/records/${id}`, { method: 'DELETE' });
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const openCreateModal = () => {
    setEditingRecord(null);
    setFormData(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEditModal = (rec: ResidenceRecord) => {
    setEditingRecord(rec);
    setFormData({ ...rec });
    setModalOpen(true);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSaving(true);
    try {
      if (editingRecord) {
        await fetch(`/api/records/${editingRecord.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
      } else {
        await fetch('/api/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
      }
      setModalOpen(false);
      await onRefresh();
    } finally {
      setFormSaving(false);
    }
  };

  const openEmailDispatchModal = () => {
    const otroRecs = records.filter((r) => r.status === 'otro_departamento');
    const first = otroRecs[0] || records[0];
    setExportDistrito(first?.distrito || '');
    setExportServicio(first?.servicio_planilla || first?.servicio_figura || '');
    setExportResponsable(first?.responsable || '');
    setEmailModalOpen(true);
  };

  const buildExcelExportUrl = (statusParam: string) => {
    const params = new URLSearchParams({
      status: statusParam,
      month: monthFilter,
    });
    if (exportDistrito.trim()) params.set('distrito', exportDistrito.trim());
    if (exportServicio.trim()) params.set('servicio', exportServicio.trim());
    if (exportResponsable.trim()) params.set('responsable', exportResponsable.trim());
    return `/api/export/excel?${params.toString()}`;
  };

  const otroDeptoRows = useMemo(
    () =>
      records.filter(
        (r) =>
          r.status === 'otro_departamento' &&
          (monthFilter === 'all' || r.month_key === monthFilter)
      ),
    [records, monthFilter]
  );

  const emailSubject = `Remisión de Planilla Cambio de Residencia - ${
    exportServicio || 'Servicio'
  } (${otroDeptoRows.length} casos)`;

  const emailBody = [
    'Estimado/a,',
    '',
    `Adjunto la planilla oficial "CAMBIO DE RESIDENCIA" correspondiente a ${otroDeptoRows.length} registro(s) marcado(s) como DE OTRO DEPARTAMENTO.`,
    exportDistrito ? `Distrito: ${exportDistrito}` : '',
    exportServicio ? `Servicio: ${exportServicio}` : '',
    exportResponsable ? `Responsable: ${exportResponsable}` : '',
    '',
    'Resumen de casos remitidos:',
    ...otroDeptoRows
      .slice(0, 15)
      .map(
        (r, i) =>
          `${i + 1}. ${r.nombres} ${r.apellidos} (Doc: ${r.documento || 'S/D'}) -> Corresponde: ${
            r.servicio_corresponde || 'Por definir'
          }`
      ),
    otroDeptoRows.length > 15 ? `... y ${otroDeptoRows.length - 15} caso(s) adicional(es) en la planilla adjunta.` : '',
    '',
    'Saludos cordiales.',
  ]
    .filter((l) => l !== '')
    .join('\n');

  const toggleAllVisible = () => {
    if (
      filteredRecords.length > 0 &&
      filteredRecords.every((r) => selectedIds.includes(r.id))
    ) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredRecords.map((r) => r.id));
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter & Export Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Segmented Status Filters */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {[
              { key: 'all', label: 'Todos' },
              { key: 'pendiente', label: 'Pendiente' },
              { key: 'realizado', label: 'Realizado' },
              { key: 'otro_departamento', label: 'De otro departamento' },
              { key: 'duplicates', label: 'Duplicados' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() =>
                  onStatusFilterChange(tab.key as RecordStatus | 'all' | 'duplicates')
                }
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === tab.key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Primary Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/export/excel?status=otro_departamento&month=${encodeURIComponent(
                monthFilter
              )}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-rose-700 text-white text-xs font-medium rounded-lg hover:bg-rose-800 transition-colors whitespace-nowrap shrink-0"
              title="Descarga planilla Excel idéntica al formato oficial solo con los marcados 'De otro departamento'"
            >
              <Download className="w-3.5 h-3.5" />
              Excel Otro Dpto. ({otroDeptoCount})
            </a>

            <button
              type="button"
              onClick={openEmailDispatchModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Mail className="w-3.5 h-3.5 text-teal-700" />
              Remitir por Correo
            </button>

            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Nuevo Registro
            </button>
          </div>
        </div>

        {/* Search & Month */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por documento, código, nombres, apellidos, barrio o servicio..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 font-mono"
            aria-label="Filtrar por mes"
          >
            <option value="all">Todos los meses</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <a
            href={`/api/export/excel?status=${encodeURIComponent(
              statusFilter === 'duplicates' ? 'all' : statusFilter
            )}&month=${encodeURIComponent(monthFilter)}`}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar Vista
          </a>
        </div>

        {/* Bulk Selection Bar */}
        {selectedIds.length > 0 && (
          <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs font-medium text-teal-950 font-mono tabular-nums">
              {selectedIds.length} fila(s) seleccionada(s)
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => handleBulkStatus('realizado')}
                className="px-3 py-1.5 bg-emerald-700 text-white text-xs font-medium rounded-md hover:bg-emerald-800 cursor-pointer whitespace-nowrap"
              >
                Marcar Realizado
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => handleBulkStatus('pendiente')}
                className="px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-md hover:bg-amber-700 cursor-pointer whitespace-nowrap"
              >
                Marcar Pendiente
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => handleBulkStatus('otro_departamento')}
                className="px-3 py-1.5 bg-rose-700 text-white text-xs font-medium rounded-md hover:bg-rose-800 cursor-pointer whitespace-nowrap"
              >
                Marcar Otro Dpto.
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Limpiar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Nominal Spreadsheet Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
          <span className="font-mono tabular-nums">
            Mostrando {filteredRecords.length} de {records.length} registro(s)
          </span>
          <span>Marque el estado directamente en cada fila</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
              <tr>
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={
                      filteredRecords.length > 0 &&
                      filteredRecords.every((r) => selectedIds.includes(r.id))
                    }
                    onChange={toggleAllVisible}
                    aria-label="Seleccionar todos"
                  />
                </th>
                <th className="px-2 py-3">N°</th>
                <th className="px-3 py-3">Documento</th>
                <th className="px-3 py-3">Código/Nro</th>
                <th className="px-3 py-3">Nombres y Apellidos</th>
                <th className="px-3 py-3">F. Nac.</th>
                <th className="px-3 py-3">Barrio Residencia</th>
                <th className="px-3 py-3">Servicio Figura</th>
                <th className="px-3 py-3">Servicio Corresponde</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-10 text-center text-slate-500">
                    No se encontraron registros con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((r, index) => (
                  <tr
                    key={r.id}
                    className={`hover:bg-slate-50 transition-colors ${
                      r.is_duplicate ? 'bg-amber-50/40' : ''
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(r.id)}
                        onChange={() =>
                          setSelectedIds((prev) =>
                            prev.includes(r.id)
                              ? prev.filter((x) => x !== r.id)
                              : [...prev, r.id]
                          )
                        }
                        aria-label={`Seleccionar fila ${r.id}`}
                      />
                    </td>
                    <td className="px-2 py-2.5 font-mono tabular-nums text-slate-500">
                      {index + 1}
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-slate-900 whitespace-nowrap">
                      <div>{r.documento || '—'}</div>
                      {r.is_duplicate && (
                        <button
                          type="button"
                          onClick={onNavigateDuplicates}
                          className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-sans font-medium text-amber-700 hover:underline cursor-pointer"
                          title={r.duplicate_reasons?.join(', ')}
                        >
                          <AlertTriangle className="w-3 h-3" />
                          Duplicado
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {r.codigo_nro || '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-900">
                        {r.nombres} {r.apellidos}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {r.distrito || 'Sin distrito'} · {r.month_key}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {r.fecha_nacimiento || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{r.barrio_residencia || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-700">{r.servicio_figura || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-700">
                      {r.servicio_corresponde || '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="inline-flex items-center gap-1 bg-slate-100 p-0.5 rounded-md">
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => handleStatusChange(r.id, 'realizado')}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                            r.status === 'realizado'
                              ? 'bg-emerald-600 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          Realizado
                        </button>
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => handleStatusChange(r.id, 'pendiente')}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                            r.status === 'pendiente'
                              ? 'bg-amber-600 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Clock className="w-3 h-3" />
                          Pendiente
                        </button>
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => handleStatusChange(r.id, 'otro_departamento')}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                            r.status === 'otro_departamento'
                              ? 'bg-rose-600 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <ArrowRightLeft className="w-3 h-3" />
                          Otro Dpto.
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEditModal(r)}
                        className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded cursor-pointer"
                        title="Editar casillas"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => handleDelete(r.id)}
                        className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded cursor-pointer"
                        title="Eliminar registro"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Record Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingRecord ? `Editar Registro #${editingRecord.id}` : 'Agregar Nuevo Registro'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveForm} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Documento
                  </label>
                  <input
                    type="text"
                    value={formData.documento || ''}
                    onChange={(e) => setFormData((d) => ({ ...d, documento: e.target.value }))}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Código / Nro
                  </label>
                  <input
                    type="text"
                    value={formData.codigo_nro || ''}
                    onChange={(e) => setFormData((d) => ({ ...d, codigo_nro: e.target.value }))}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Nombres
                  </label>
                  <input
                    type="text"
                    value={formData.nombres || ''}
                    onChange={(e) => setFormData((d) => ({ ...d, nombres: e.target.value }))}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Apellidos
                  </label>
                  <input
                    type="text"
                    value={formData.apellidos || ''}
                    onChange={(e) => setFormData((d) => ({ ...d, apellidos: e.target.value }))}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Fecha de Nacimiento
                  </label>
                  <input
                    type="text"
                    placeholder="DD/MM/AAAA"
                    value={formData.fecha_nacimiento || ''}
                    onChange={(e) =>
                      setFormData((d) => ({ ...d, fecha_nacimiento: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Barrio de Residencia
                  </label>
                  <input
                    type="text"
                    value={formData.barrio_residencia || ''}
                    onChange={(e) =>
                      setFormData((d) => ({ ...d, barrio_residencia: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Servicio donde Figura
                  </label>
                  <input
                    type="text"
                    value={formData.servicio_figura || ''}
                    onChange={(e) =>
                      setFormData((d) => ({ ...d, servicio_figura: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Servicio donde Corresponde
                  </label>
                  <input
                    type="text"
                    value={formData.servicio_corresponde || ''}
                    onChange={(e) =>
                      setFormData((d) => ({ ...d, servicio_corresponde: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Distrito
                  </label>
                  <input
                    type="text"
                    value={formData.distrito || ''}
                    onChange={(e) => setFormData((d) => ({ ...d, distrito: e.target.value }))}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Responsable
                  </label>
                  <input
                    type="text"
                    value={formData.responsable || ''}
                    onChange={(e) => setFormData((d) => ({ ...d, responsable: e.target.value }))}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Estado
                  </label>
                  <select
                    value={formData.status || 'pendiente'}
                    onChange={(e) =>
                      setFormData((d) => ({ ...d, status: e.target.value as RecordStatus }))
                    }
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
                  >
                    <option value="pendiente">Pendiente</option>
                    <option value="realizado">Realizado</option>
                    <option value="otro_departamento">De otro departamento</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Mes de Registro
                  </label>
                  <input
                    type="month"
                    value={formData.month_key || ''}
                    onChange={(e) => setFormData((d) => ({ ...d, month_key: e.target.value }))}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md font-mono"
                  />
                </div>
              </div>
              <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={formSaving}
                  className="px-4 py-2 text-xs font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
                >
                  {formSaving ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Email Dispatch & Official Excel Export Modal */}
      {emailModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Remitir Planilla "De Otro Departamento" por Correo
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {otroDeptoRows.length} registro(s) listo(s) para exportar en formato oficial
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEmailModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    DISTRITO (Encabezado)
                  </label>
                  <input
                    type="text"
                    value={exportDistrito}
                    onChange={(e) => setExportDistrito(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    SERVICIO (Encabezado)
                  </label>
                  <input
                    type="text"
                    value={exportServicio}
                    onChange={(e) => setExportServicio(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    RESPONSABLE
                  </label>
                  <input
                    type="text"
                    value={exportResponsable}
                    onChange={(e) => setExportResponsable(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Correo Electrónico Destinatario
                </label>
                <input
                  type="email"
                  placeholder="coordinacion.departamento@salud.gov"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-600">
                    Texto del Correo
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`${emailSubject}\n\n${emailBody}`);
                      setCopiedSummary(true);
                      setTimeout(() => setCopiedSummary(false), 2000);
                    }}
                    className="inline-flex items-center gap-1 text-xs text-teal-700 hover:underline cursor-pointer"
                  >
                    {copiedSummary ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedSummary ? 'Copiado' : 'Copiar texto'}
                  </button>
                </div>
                <textarea
                  readOnly
                  rows={6}
                  value={emailBody}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-mono"
                />
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <a
                  href={buildExcelExportUrl('otro_departamento')}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-rose-700 text-white text-xs font-medium rounded-lg hover:bg-rose-800 whitespace-nowrap"
                >
                  <Download className="w-4 h-4" />
                  1. Descargar Excel Oficial (.xlsx)
                </a>
                <a
                  href={`mailto:${encodeURIComponent(emailTo)}?subject=${encodeURIComponent(
                    emailSubject
                  )}&body=${encodeURIComponent(emailBody)}`}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap"
                >
                  <Mail className="w-4 h-4" />
                  2. Abrir Redacción de Correo
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
