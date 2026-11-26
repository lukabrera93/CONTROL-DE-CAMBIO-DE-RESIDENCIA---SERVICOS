import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  LayoutDashboard,
  Table2,
  Upload,
  CopyCheck,
  HardDrive,
  Bell,
  Menu,
  X,
  AlertTriangle,
  CheckCircle2,
  Info,
  Printer,
  LogOut,
} from 'lucide-react';
import type {
  ResidenceRecord,
  DuplicateCluster,
  AnalyticsSummary,
  AppNotification,
  BackupEntry,
  UploadBatch,
  RecordStatus,
} from './types';
import {
  fetchAppSnapshot,
  syncPendingOutbox,
  isBackendAvailable,
  loadDemoRecords,
} from './lib/dataService';
import { DashboardView } from './components/DashboardView';
import { RecordsView } from './components/RecordsView';
import { UploadView } from './components/UploadView';
import { DuplicatesView } from './components/DuplicatesView';
import { BackupsView } from './components/BackupsView';
import {
  PWAInstallButton,
  OfflineSyncBanner,
  useOnlineStatus,
} from './components/PWAInstallButton';
import { MonthlyReportPrintModal } from './components/MonthlyReportPrintModal';

type TabKey =
  | 'dashboard'
  | 'records'
  | 'upload'
  | 'duplicates'
  | 'backups';

const TAB_LABELS: Record<TabKey, string> = {
  dashboard: 'Panel y Avance Mensual',
  records: 'Planilla Nominal',
  upload: 'Cargar Planilla Excel',
  duplicates: 'Control de Duplicados',
  backups: 'Respaldos y Restauración',
};

export default function App() {
  const isOnline = useOnlineStatus();
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [statusFilter, setStatusFilter] = useState<RecordStatus | 'all' | 'duplicates'>('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [demoLoading, setDemoLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [fromOfflineCache, setFromOfflineCache] = useState(false);

  const [records, setRecords] = useState<ResidenceRecord[]>([]);
  const [duplicateClusters, setDuplicateClusters] = useState<DuplicateCluster[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [uploads, setUploads] = useState<UploadBatch[]>([]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [hasBackend, setHasBackend] = useState(false);

  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);
  const [toastAlert, setToastAlert] = useState<AppNotification | null>(null);
  const [printReportOpen, setPrintReportOpen] = useState(false);
  const [exitPromptOpen, setExitPromptOpen] = useState(false);
  const [appClosed, setAppClosed] = useState(false);
  const bypassUnloadRef = useRef(false);

  const fetchAllData = useCallback(async () => {
    try {
      const [snap, backendOk] = await Promise.all([
        fetchAppSnapshot(),
        isBackendAvailable(),
      ]);
      setHasBackend(backendOk);
      setRecords(snap.records);
      setDuplicateClusters(snap.duplicateClusters);
      setAnalytics(snap.analytics);
      setUploads(snap.uploads);
      setBackups(snap.backups);
      setNotifications(snap.notifications);
      setFromOfflineCache(snap.fromOfflineCache);
      setPendingSyncCount(snap.pendingSyncCount);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSyncNow = useCallback(async () => {
    if (!navigator.onLine) return;
    if (!(await isBackendAvailable(true))) return;
    setSyncing(true);
    try {
      await syncPendingOutbox();
      await fetchAllData();
    } finally {
      setSyncing(false);
    }
  }, [fetchAllData]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Auto-sync queued offline operations when connectivity returns
  useEffect(() => {
    if (isOnline && hasBackend && pendingSyncCount > 0) {
      handleSyncNow();
    }
  }, [isOnline, hasBackend, pendingSyncCount, handleSyncNow]);

  // Real-time SSE connection when online and Express backend is present
  useEffect(() => {
    if (!isOnline || !hasBackend) {
      return;
    }

    const es = new EventSource('/api/events');

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

    es.addEventListener('data_changed', () => {
      fetchAllData();
    });

    return () => {
      es.close();
    };
  }, [fetchAllData, isOnline, hasBackend]);

  useEffect(() => {
    if (!toastAlert) return;
    const t = setTimeout(() => setToastAlert(null), 8000);
    return () => clearTimeout(t);
  }, [toastAlert]);

  // Intercept browser tab/window close attempts and show floating backup prompt if user stays
  useEffect(() => {
    if (appClosed) return;

    let reopenTimer: number | null = null;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (bypassUnloadRef.current) return;
      e.preventDefault();
      e.returnValue = '';

      if (reopenTimer !== null) {
        window.clearTimeout(reopenTimer);
      }
      reopenTimer = window.setTimeout(() => {
        if (!bypassUnloadRef.current) {
          setExitPromptOpen(true);
        }
      }, 150);
    };

    const handlePageHide = () => {
      if (reopenTimer !== null) {
        window.clearTimeout(reopenTimer);
        reopenTimer = null;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      if (reopenTimer !== null) {
        window.clearTimeout(reopenTimer);
      }
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [appClosed]);

  const handleRequestCloseApp = () => {
    setMobileMenuOpen(false);
    setExitPromptOpen(true);
  };

  const handleAcceptBackupBeforeClose = () => {
    setExitPromptOpen(false);
    setActiveTab('backups');
  };

  const handleRejectBackupAndClose = () => {
    bypassUnloadRef.current = true;
    setExitPromptOpen(false);
    window.close();
    window.setTimeout(() => {
      if (!window.closed) {
        setAppClosed(true);
      }
    }, 150);
  };

  const handleReopenApp = () => {
    bypassUnloadRef.current = false;
    setAppClosed(false);
  };

  const unreadCount = notifications.filter((n) => n.is_read === 0).length;

  const handleMarkAllRead = async () => {
    if (isOnline && hasBackend) {
      await fetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
    }
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
      await loadDemoRecords();
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
  ];

  if (appClosed) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-lg shadow-sm p-6 text-center space-y-4">
          <div className="w-11 h-11 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center mx-auto">
            <LogOut className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              ResiControl cerrado
            </h1>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              Ha decidido salir sin realizar una copia de respaldo adicional. Por seguridad del navegador, si esta pestaña no se cerró automáticamente, ya puede cerrarla manualmente sin advertencias.
            </p>
          </div>
          <div className="pt-2 flex justify-center">
            <button
              type="button"
              onClick={handleReopenApp}
              className="px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 transition-colors cursor-pointer"
            >
              Volver a abrir ResiControl
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="no-print fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Sidebar (256px) */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
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

          <div className="pt-3 mt-3 border-t border-slate-200 space-y-1">
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                setPrintReportOpen(true);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-slate-700 rounded-lg hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4 text-teal-700 shrink-0" />
              <span className="truncate">Imprimir Informe Mensual</span>
            </button>

            <button
              type="button"
              onClick={handleRequestCloseApp}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-slate-600 rounded-lg hover:bg-rose-50 hover:text-rose-700 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span className="truncate">Cerrar Aplicación</span>
            </button>
          </div>
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <PWAInstallButton variant="sidebar" records={records} hasBackend={hasBackend} />
          <div className="text-xs text-slate-500">
            <div>Cambio de Residencia</div>
            <div className="mt-0.5 font-mono tabular-nums text-[11px] text-slate-400">
              {!isOnline
                ? 'Modo Offline (IndexedDB)'
                : hasBackend && !fromOfflineCache
                ? 'SQLite + PWA Offline'
                : 'Modo Web Local (IndexedDB)'}{' '}
              · {analytics?.totals.total || 0} reg.
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract */}
        <header className="no-print h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-20 shrink-0">
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

            <PWAInstallButton variant="header" records={records} hasBackend={hasBackend} />

            <button
              type="button"
              onClick={() => handleNavigate('upload')}
              className="px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Subir Planilla Excel
            </button>

            <button
              type="button"
              onClick={handleRequestCloseApp}
              title="Cerrar aplicación"
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 bg-white text-slate-700 text-xs font-medium rounded-lg hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Cerrar</span>
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

        <OfflineSyncBanner
          isOnline={isOnline}
          hasBackend={hasBackend}
          pendingCount={pendingSyncCount}
          syncing={syncing}
          onSyncNow={handleSyncNow}
        />

        {/* Main Viewport */}
        <main
          className={`flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto ${
            printReportOpen ? 'no-print' : ''
          }`}
        >
          {activeTab === 'dashboard' && (
            <DashboardView
              analytics={analytics}
              loading={loading}
              onNavigate={handleNavigate}
              onLoadDemo={handleLoadDemo}
              demoLoading={demoLoading}
              onOpenPrintReport={() => setPrintReportOpen(true)}
            />
          )}

          {activeTab === 'records' && (
            <RecordsView
              records={records}
              uploads={uploads}
              availableMonths={analytics?.availableMonths || []}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              onRefresh={fetchAllData}
              onNavigateDuplicates={() => handleNavigate('duplicates')}
              onOpenPrintReport={() => setPrintReportOpen(true)}
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
              records={records}
              onRefresh={fetchAllData}
            />
          )}
        </main>

        <footer className="no-print border-t border-slate-200 bg-white px-4 sm:px-6 py-3 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            © {new Date().getFullYear()} ResiControl · Todos los derechos reservados.
          </span>
          <span className="font-medium text-slate-700">
            Desarrollado por Lucio Pastor Cabrera Olmedo
          </span>
        </footer>
      </div>

      {/* Printable Monthly Progress Report Modal */}
      <MonthlyReportPrintModal
        open={printReportOpen}
        onClose={() => setPrintReportOpen(false)}
        records={records}
        uploads={uploads}
        availableMonths={analytics?.availableMonths || []}
      />

      {/* Floating Backup Confirmation Modal Before Closing App */}
      {exitPromptOpen && (
        <div
          className="no-print fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exit-backup-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h2
                    id="exit-backup-title"
                    className="text-sm font-semibold text-slate-900"
                  >
                    ¿Hacer copia de respaldo antes de cerrar?
                  </h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Protección de datos · {records.length} registro(s) cargados
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExitPromptOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                aria-label="Cancelar cierre"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 text-xs text-slate-600 leading-relaxed space-y-2">
              <p>
                Antes de salir de ResiControl, puede guardar una copia de respaldo completa de sus planillas y registros.
              </p>
              <p className="text-slate-500">
                Si acepta, será dirigido a la sección de <strong>Respaldos</strong>. Si rechaza, la aplicación se cerrará.
              </p>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button
                type="button"
                onClick={handleRejectBackupAndClose}
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 transition-colors cursor-pointer"
              >
                Rechazar y cerrar
              </button>
              <button
                type="button"
                onClick={handleAcceptBackupBeforeClose}
                className="px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 transition-colors cursor-pointer"
              >
                Aceptar e ir a Respaldos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Automatic Duplicate / Import Real-time Toast Notification */}
      {toastAlert && (
        <div className="no-print fixed bottom-5 right-5 z-50 max-w-sm bg-white border border-slate-200 rounded-lg shadow-lg p-4">
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
