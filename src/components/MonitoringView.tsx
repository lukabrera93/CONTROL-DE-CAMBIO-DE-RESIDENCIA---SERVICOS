import React, { useState, useMemo } from 'react';
import {
  Activity,
  Download,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import type {
  ServerMetricsSnapshot,
  MonthlyServerReport,
  SystemLogEntry,
} from '../types';

interface MonitoringViewProps {
  metrics: ServerMetricsSnapshot | null;
  monthlyReports: MonthlyServerReport[];
  logs: SystemLogEntry[];
  sseConnected: boolean;
  onRefresh: () => Promise<void>;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export const MonitoringView: React.FC<MonitoringViewProps> = ({
  metrics,
  monthlyReports,
  logs,
  sseConnected,
  onRefresh,
}) => {
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR'>('ALL');
  const [catFilter, setCatFilter] = useState<string>('ALL');

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (levelFilter !== 'ALL' && l.level !== levelFilter) return false;
      if (catFilter !== 'ALL' && l.category !== catFilter) return false;
      return true;
    });
  }, [logs, levelFilter, catFilter]);

  const categories = useMemo(
    () => Array.from(new Set(logs.map((l) => l.category))).sort(),
    [logs]
  );

  return (
    <div className="space-y-6">
      {/* Real-time Server Health & Live Telemetry */}
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2.5">
            <Server className="w-5 h-5 text-teal-700" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Rendimiento del Servidor en Tiempo Real
              </h2>
              <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                <span>
                  Flujo SSE:{' '}
                  <strong className={sseConnected ? 'text-emerald-700' : 'text-amber-700'}>
                    {sseConnected ? 'Conectado' : 'Reconectando'}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {metrics?.cpuCores || 1} vCPU · SQLite {metrics?.dbSizeKb ?? 0} KB
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Actualizar
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="text-[11px] font-medium text-slate-500">Tiempo Activo</div>
            <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-slate-900">
              {metrics ? formatUptime(metrics.uptimeSeconds) : '—'}
            </div>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="text-[11px] font-medium text-slate-500">Memoria RSS</div>
            <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-slate-900">
              {metrics ? `${metrics.memoryRssMb} MB` : '—'}
            </div>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="text-[11px] font-medium text-slate-500">Carga CPU (1m)</div>
            <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-slate-900">
              {metrics ? metrics.loadAvg1m.toFixed(2) : '—'}
            </div>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="text-[11px] font-medium text-slate-500">Latencia Media</div>
            <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-teal-700">
              {metrics ? `${metrics.avgLatencyMs} ms` : '—'}
            </div>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="text-[11px] font-medium text-slate-500">Solicitudes / min</div>
            <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-slate-900">
              {metrics ? metrics.requestsLastMinute : 0}
            </div>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="text-[11px] font-medium text-slate-500">Tasa de Error</div>
            <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-emerald-700">
              {metrics ? `${metrics.errorRatePercent}%` : '0%'}
            </div>
          </div>
        </div>
      </div>

      {/* Monthly Server Performance Reports */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-teal-700" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Informes Mensuales de Rendimiento del Servidor
              </h3>
              <p className="text-xs text-slate-500">
                Disponibilidad, latencia y consumo acumulado por periodo mensual
              </p>
            </div>
          </div>
          <a
            href="/api/reports/monthly/export"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Descargar Informe Mensual (.csv)
          </a>
        </div>

        {monthlyReports.length > 0 && (
          <div className="p-6 border-b border-slate-200 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...monthlyReports].reverse()}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#475569' }} />
                <YAxis tick={{ fontSize: 12, fill: '#475569' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderColor: '#e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="total_requests" name="Solicitudes API" fill="#0f766e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="exports_generated" name="Exportaciones Excel" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-6 py-3">Mes</th>
                <th className="px-4 py-3 text-right">Solicitudes</th>
                <th className="px-4 py-3 text-right">Errores</th>
                <th className="px-4 py-3 text-right">Disponibilidad</th>
                <th className="px-4 py-3 text-right">Latencia Media</th>
                <th className="px-4 py-3 text-right">Latencia Máx.</th>
                <th className="px-4 py-3 text-right">Pico Memoria</th>
                <th className="px-4 py-3 text-right">Exports</th>
                <th className="px-6 py-3 text-right">Backups</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {monthlyReports.map((r) => (
                <tr key={r.month_key} className="hover:bg-slate-50">
                  <td className="px-6 py-3 font-medium text-slate-900">{r.label}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {r.total_requests}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                    {r.error_requests}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700 font-medium">
                    {r.availability_percent}%
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {r.avg_latency_ms} ms
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                    {r.max_latency_ms} ms
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {r.peak_memory_mb} MB
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {r.exports_generated}
                  </td>
                  <td className="px-6 py-3 text-right font-mono tabular-nums">
                    {r.backups_created}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Security Safeguards & Detailed System Logs */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-teal-700" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Logs Detallados del Sistema y Auditoría
              </h3>
              <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                Consultas SQL parametrizadas · Cabeceras de seguridad activas · Límite de tasa habilitado
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={levelFilter}
              onChange={(e) =>
                setLevelFilter(e.target.value as 'ALL' | 'INFO' | 'WARN' | 'ERROR')
              }
              className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md"
              aria-label="Filtrar nivel de log"
            >
              <option value="ALL">Todos los niveles</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
            </select>
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md"
              aria-label="Filtrar categoría de log"
            >
              <option value="ALL">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
              <tr>
                <th className="px-6 py-2.5">Timestamp</th>
                <th className="px-3 py-2.5">Nivel</th>
                <th className="px-3 py-2.5">Categoría</th>
                <th className="px-4 py-2.5">Evento</th>
                <th className="px-6 py-2.5">Detalle Técnico</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-6 py-2.5 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString('es-ES')}
                  </td>
                  <td className="px-3 py-2.5 font-mono font-medium">
                    <span
                      className={
                        log.level === 'ERROR'
                          ? 'text-rose-700'
                          : log.level === 'WARN'
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                      }
                    >
                      {log.level}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-700">{log.category}</td>
                  <td className="px-4 py-2.5 text-slate-900">{log.message}</td>
                  <td className="px-6 py-2.5 font-mono text-[11px] text-slate-500 max-w-xs truncate">
                    {log.details}
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
