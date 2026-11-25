import React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  CheckCircle2,
  Clock,
  ArrowRightLeft,
  AlertTriangle,
  Upload,
  FileSpreadsheet,
  ArrowRight,
  Database,
} from 'lucide-react';
import type { AnalyticsSummary, RecordStatus } from '../types';

interface DashboardViewProps {
  analytics: AnalyticsSummary | null;
  loading: boolean;
  onNavigate: (tab: string, statusFilter?: RecordStatus | 'all' | 'duplicates') => void;
  onLoadDemo: () => Promise<void>;
  demoLoading: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  analytics,
  loading,
  onNavigate,
  onLoadDemo,
  demoLoading,
}) => {
  if (loading && !analytics) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-80 bg-white border border-slate-200 rounded-lg animate-pulse" />
      </div>
    );
  }

  const totals = analytics?.totals || {
    total: 0,
    realizado: 0,
    pendiente: 0,
    otro_departamento: 0,
    completionRate: 0,
    duplicateRecords: 0,
    duplicateClusters: 0,
  };

  if (totals.total === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-10 text-center max-w-2xl mx-auto mt-6">
        <div className="w-12 h-12 rounded-lg bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center mx-auto mb-4">
          <FileSpreadsheet className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">
          Aún no hay planillas cargadas en la base de datos
        </h2>
        <p className="text-sm text-slate-600 mb-6 leading-relaxed">
          Suba una planilla Excel en formato <span className="font-medium text-slate-800">Cambio de Residencia</span> para comenzar a registrar estados, detectar duplicados automáticamente y generar planillas para remitir a otros departamentos.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate('upload')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            Subir Planilla Excel
          </button>
          <a
            href="/api/export/excel?template=true"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            Descargar Plantilla Oficial
          </a>
          <button
            type="button"
            disabled={demoLoading}
            onClick={onLoadDemo}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <Database className="w-4 h-4" />
            {demoLoading ? 'Cargando ejemplo...' : 'Cargar Planilla de Ejemplo'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {totals.duplicateClusters > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-amber-950">
                Se detectaron {totals.duplicateRecords} registros redundantes en {totals.duplicateClusters} grupo(s)
              </h3>
              <p className="text-xs text-amber-800 mt-0.5">
                Coincidencias detectadas por número de documento, código/nro o identidad completa. Revise y depure antes de remitir planillas.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('duplicates')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-amber-700 text-white text-xs font-medium rounded-lg hover:bg-amber-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Revisar Duplicados
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('records', 'all')}
          className="text-left bg-white border border-slate-200 rounded-lg p-5 hover:border-slate-300 transition-colors cursor-pointer"
        >
          <div className="text-xs font-medium text-slate-500">Total de Registros</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-semibold text-slate-900 font-mono tabular-nums">
              {totals.total}
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {totals.completionRate}% completado
            </span>
          </div>
          <div className="mt-3 w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-600 transition-all duration-300"
              style={{ width: `${Math.min(100, totals.completionRate)}%` }}
            />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('records', 'realizado')}
          className="text-left bg-white border border-slate-200 rounded-lg p-5 hover:border-emerald-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Realizado</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-semibold text-emerald-700 font-mono tabular-nums">
              {totals.realizado}
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {totals.total > 0 ? Math.round((totals.realizado / totals.total) * 100) : 0}% del total
            </span>
          </div>
          <div className="mt-3 text-xs text-slate-500">Casos finalizados en zona</div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('records', 'pendiente')}
          className="text-left bg-white border border-slate-200 rounded-lg p-5 hover:border-amber-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Pendiente</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-semibold text-amber-700 font-mono tabular-nums">
              {totals.pendiente}
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {totals.total > 0 ? Math.round((totals.pendiente / totals.total) * 100) : 0}% del total
            </span>
          </div>
          <div className="mt-3 text-xs text-slate-500">Requieren verificación</div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('records', 'otro_departamento')}
          className="text-left bg-white border border-slate-200 rounded-lg p-5 hover:border-rose-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">De otro departamento</span>
            <ArrowRightLeft className="w-4 h-4 text-rose-600" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-semibold text-rose-700 font-mono tabular-nums">
              {totals.otro_departamento}
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              Listos para remitir
            </span>
          </div>
          <div className="mt-3 text-xs text-rose-700 font-medium">
            Filtrar y descargar Excel oficial
          </div>
        </button>
      </div>

      {/* Real-time Monthly Chart + Monthly Table */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Avance Mensual en Tiempo Real
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Distribución mensual por estado y tasa de cumplimiento acumulado
              </p>
            </div>
            <div className="text-xs text-slate-500 font-mono tabular-nums">
              {analytics?.monthly.length || 0} mes(es) registrado(s)
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={analytics?.monthly || []}
                margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: '#475569' }}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 12, fill: '#475569' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, 100]}
                  unit="%"
                  tick={{ fontSize: 11, fill: '#0f766e' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderColor: '#e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                <Bar
                  yAxisId="left"
                  dataKey="realizado"
                  name="Realizado"
                  stackId="a"
                  fill="#16a34a"
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  yAxisId="left"
                  dataKey="pendiente"
                  name="Pendiente"
                  stackId="a"
                  fill="#d97706"
                />
                <Bar
                  yAxisId="left"
                  dataKey="otro_departamento"
                  name="De otro dpto."
                  stackId="a"
                  fill="#dc2626"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="completionRate"
                  name="% Realizado"
                  stroke="#0f766e"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#0f766e' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Service Breakdown */}
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900">
              Por Servicio de Origen
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Servicios donde figuran los registros cargados
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {(analytics?.byService || []).map((svc) => {
              const pct = svc.total > 0 ? Math.round((svc.realizado / svc.total) * 100) : 0;
              return (
                <div key={svc.servicio} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-slate-800 truncate" title={svc.servicio}>
                      {svc.servicio}
                    </span>
                    <span className="font-mono tabular-nums text-xs text-slate-600 shrink-0">
                      {svc.total} reg. · {pct}%
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-500 font-mono tabular-nums">
                    <span className="text-emerald-700">Realiz: {svc.realizado}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-amber-700">Pend: {svc.pendiente}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-rose-700">Otro Dpto: {svc.otro_departamento}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Monthly Numeric Summary Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Resumen Numérico Mensual
          </h3>
          <span className="text-xs text-slate-500">Actualización automática en vivo</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
              <tr>
                <th className="px-6 py-3">Mes</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Realizado</th>
                <th className="px-4 py-3 text-right">Pendiente</th>
                <th className="px-4 py-3 text-right">De otro departamento</th>
                <th className="px-6 py-3 text-right">% Avance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(analytics?.monthly || []).map((m) => (
                <tr key={m.month_key} className="hover:bg-slate-50">
                  <td className="px-6 py-3 font-medium text-slate-900">{m.label}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">
                    {m.total}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700">
                    {m.realizado}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-700">
                    {m.pendiente}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-rose-700">
                    {m.otro_departamento}
                  </td>
                  <td className="px-6 py-3 text-right font-mono tabular-nums font-medium text-teal-700">
                    {m.completionRate}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
