import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  Table2,
  Upload,
  CopyCheck,
  HardDrive,
  Activity,
  GitBranch,
  Bell,
  Menu,
  X,
  AlertTriangle,
  CheckCircle2,
  Info,
} from 'lucide-react';
import type {
  ResidenceRecord,
  DuplicateCluster,
  AnalyticsSummary,
  SystemLogEntry,
  AppNotification,
  BackupEntry,
  UploadBatch,
  ServerMetricsSnapshot,
  MonthlyServerReport,
  RecordStatus,
} from './types';
import { DashboardView } from './components/DashboardView';
import { RecordsView } from './components/RecordsView';
import { UploadView } from './components/UploadView';
import { DuplicatesView } from './components/DuplicatesView';
import { BackupsView } from './components/BackupsView';
import { MonitoringView } from './components/MonitoringView';
import { CicdView } from './components/CicdView';

type TabKey =
  | 'dashboard'
  | 'records'
  | 'upload'
  | 'duplicates'
  | 'backups'
  | 'monitoring'
  | 'cicd';

const TAB_LABELS: Record<TabKey, string> = {
  dashboard: 'Panel y Avance Mensual',
  records: 'Planilla Nominal',
  upload: 'Cargar Planilla Excel',
  duplicates: 'Control de Duplicados',
  backups: 'Respaldos y Restauración',
  monitoring: 'Monitoreo, Logs e Informes',
  cicd: 'GitHub, CI/CD y Despliegue',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [statusFilter, setStatusFilter] = useState<RecordStatus | 'all' | 'duplicates'>('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [demoLoading, setDemoLoading] = useState(false);
  const [records, setRecords] = useState<ResidenceRecord[]>([]);
  const [duplicateClusters, setDuplicateClusters] = useState<DuplicateCluster[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [uploads, setUploads] = useState<UploadBatch[]>([]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [logs, setLogs] = useState<SystemLogEntry[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [metrics, setMetrics] = useState<ServerMetricsSnapshot | null>(null);
  const [monthlyReports, setMonthlyReports] = useState<MonthlyServerReport[]>([]);
  const [sseConnected, setSseConnected] = useState(false);

  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);
  const [toastAlert, setToastAlert] = useState<AppNotification | null>(null);

  const fetchAllData = useCallback(async () => {
    try {
      const [
        recRes,
        anaRes,
        upRes,
        bakRes,
        logRes,
        notifRes,
        metRes,
        repRes,
      ] = await Promise.all([
        fetch('/api/records').then((r) => r.json()),
        fetch('/api/analytics').then((r) => r.json()),
        fetch('/api/uploads').then((r) => r.json()),
        fetch('/api/backups').then((r) => r.json()),
        fetch('/api/logs').then((r) => r.json()),
        fetch('/api/notifications').then((r) => r.json()),
        fetch('/api/metrics').then((r) => r.json()),
        fetch('/api/reports/monthly').then((r) => r.json()),
      ]);

      setRecords(recRes.records || []);
      setDuplicateClusters(recRes.duplicateClusters || []);
      setAnalytics(anaRes || null);
      setUploads(upRes.uploads || []);
      setBackups(bakRes.backups || []);
      setLogs(logRes.logs || []);
      setNotifications(notifRes.notifications || []);
      setMetrics(metRes || null);
      setMonthlyReports(repRes.reports || []);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Real-time SSE connection for notifications, metrics, logs & live sync
  useEffect(() => {
    const es = new EventSource('/api/events');

    es.addEventListener('connected', () => {
      setSseConnected(true);
    });

    es.addEventListener('metrics', (e) => {
      try {
        const snapshot = JSON.parse((e as MessageEvent).data) as ServerMetricsSnapshot;
        setMetrics(snapshot);
      } catch {
        // Ignore parse issues
      }
    });

    es.addEventListener('notification', (e) => {
      try {
        const notif = JSON.parse((e as MessageEvent).data) as AppNotification;
        setNotifications((prev) => [notif, ...prev].slice(0, 60));
        if (notif.type === 'duplicate_alert' || notif.type === 'import_success') {
          setToastAlert(notif);
        }
      } catch {
        // Ignore parse issues
      }
    });

    es.addEventListener('log', (e) => {
      try {
        const entry = JSON.parse((e as MessageEvent).data) as SystemLogEntry;
        setLogs((prev) => [entry, ...prev].slice(0, 200));
      } catch {
        // Ignore parse issues
      }
    });

    es.addEventListener('data_changed', () => {
      fetchAllData();
    });

    es.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      es.close();
    };
  }, [fetchAllData]);

  useEffect(() => {
    if (!toastAlert) return;
    const t = setTimeout(() => setToastAlert(null), 8000);
    return () => clearTimeout(t);
  }, [toastAlert]);

  const unreadCount = notifications.filter((n) => n.is_read === 0).length;

  const handleMarkAllRead = async () => {
    await fetch('/api/notifications/read-all', { method: 'POST' });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
  };

  const handleNavigate = (
    tab: string,
    filter?: RecordStatus | 'all' | 'duplicates'
  ) => {
    setActiveTab(tab as TabKey);
    if (filter !== undefined) {
      setStatusFilter(filter);
    }
    setMobileMenuOpen(false);
  };

  const handleLoadDemo = async () => {
    setDemoLoading(true);
    try {
      await fetch('/api/demo-load', { method: 'POST' });
      await fetchAllData();
    } finally {
      setDemoLoading(false);
    }
  };

  const navItems: Array<{
    key: TabKey;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
    warn?: boolean;
  }> = [
    { key: 'dashboard', label: 'Panel y Avance', icon: LayoutDashboard },
    {
      key: 'records',
      label: 'Planilla Nominal',
      icon: Table2,
      count: records.length,
    },
    { key: 'upload', label: 'Cargar Excel', icon: Upload },
    {
      key: 'duplicates',
      label: 'Duplicados',
      icon: CopyCheck,
      count: duplicateClusters.length,
      warn: duplicateClusters.length > 0,
    },
    { key: 'backups', label: 'Respaldos', icon: HardDrive },
    { key: 'monitoring', label: 'Monitoreo y Logs', icon: Activity },
    { key: 'cicd', label: 'GitHub y CI/CD', icon: GitBranch },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Sidebar (256px) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 px-6 border-b border-slate-200 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={() => handleNavigate('dashboard')}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            ResiControl
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
            aria-label="Cerrar menú"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleNavigate(item.key)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                  active
                    ? 'bg-teal-50 text-teal-800'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-3 truncate">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      active ? 'text-teal-700' : 'text-slate-400'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.count !== undefined && item.count > 0 && (
                  <span
                    className={`text-xs font-mono tabular-nums shrink-0 ${
                      item.warn ? 'text-amber-700 font-semibold' : 'text-slate-500'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 text-xs text-slate-500">
          <div>Cambio de Residencia</div>
          <div className="mt-0.5 font-mono tabular-nums text-[11px] text-slate-400">
            SQLite · {analytics?.totals.total || 0} reg.
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-20 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-slate-600 hover:text-slate-900 rounded-lg cursor-pointer"
              aria-label="Abrir menú"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 hidden sm:inline whitespace-nowrap">
                ResiControl
              </span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <h1 className="font-semibold text-slate-900 truncate">
                {TAB_LABELS[activeTab]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 relative">
            <button
              type="button"
              onClick={() => {
                setNotifDrawerOpen((o) => !o);
                if (!notifDrawerOpen && unreadCount > 0) {
                  handleMarkAllRead();
                }
              }}
              className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              aria-label="Notificaciones en tiempo real"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-rose-600 text-white text-[10px] font-mono font-semibold rounded-full flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleNavigate('upload')}
              className="px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Subir Planilla Excel
            </button>

            {/* Notifications Popover */}
            {notifDrawerOpen && (
              <div className="absolute right-0 top-12 w-80 sm:w-96 bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900">
                    Notificaciones en Tiempo Real
                  </span>
                  <button
                    type="button"
                    onClick={() => setNotifDrawerOpen(false)}
                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500">
                      No hay notificaciones recientes.
                    </div>
                  ) : (
                    notifications.slice(0, 20).map((n) => (
                      <div key={n.id} className="p-3.5 hover:bg-slate-50">
                        <div className="flex items-start gap-2.5">
                          {n.type === 'duplicate_alert' ? (
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          ) : n.type === 'import_success' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          ) : (
                            <Info className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-slate-900">
                              {n.title}
                            </div>
                            <p className="text-xs text-slate-600 mt-0.5 leading-snug">
                              {n.message}
                            </p>
                            <div className="text-[11px] font-mono text-slate-400 mt-1">
                              {new Date(n.timestamp).toLocaleString('es-ES')}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardView
              analytics={analytics}
              loading={loading}
              onNavigate={handleNavigate}
              onLoadDemo={handleLoadDemo}
              demoLoading={demoLoading}
            />
          )}

          {activeTab === 'records' && (
            <RecordsView
              records={records}
              availableMonths={analytics?.availableMonths || []}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              onRefresh={fetchAllData}
              onNavigateDuplicates={() => handleNavigate('duplicates')}
            />
          )}

          {activeTab === 'upload' && (
            <UploadView
              uploads={uploads}
              onImportSuccess={async () => {
                await fetchAllData();
              }}
              onNavigateDuplicates={() => handleNavigate('duplicates')}
            />
          )}

          {activeTab === 'duplicates' && (
            <DuplicatesView clusters={duplicateClusters} onRefresh={fetchAllData} />
          )}

          {activeTab === 'backups' && (
            <BackupsView
              backups={backups}
              totalRecords={records.length}
              onRefresh={fetchAllData}
            />
          )}

          {activeTab === 'monitoring' && (
            <MonitoringView
              metrics={metrics}
              monthlyReports={monthlyReports}
              logs={logs}
              sseConnected={sseConnected}
              onRefresh={fetchAllData}
            />
          )}

          {activeTab === 'cicd' && <CicdView />}
        </main>
      </div>

      {/* Automatic Duplicate / Import Real-time Toast Notification */}
      {toastAlert && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm bg-white border border-slate-200 rounded-lg shadow-lg p-4">
          <div className="flex items-start gap-3">
            {toastAlert.type === 'duplicate_alert' ? (
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-slate-900">
                {toastAlert.title}
              </div>
              <p className="text-xs text-slate-600 mt-1 leading-snug">
                {toastAlert.message}
              </p>
              {toastAlert.type === 'duplicate_alert' && (
                <button
                  type="button"
                  onClick={() => {
                    setToastAlert(null);
                    handleNavigate('duplicates');
                  }}
                  className="mt-2 text-xs font-medium text-amber-700 hover:underline cursor-pointer"
                >
                  Ir a filtrar y depurar duplicados →
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setToastAlert(null)}
              className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              aria-label="Cerrar notificación"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
