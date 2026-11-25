import React, { useEffect, useState } from 'react';
import {
  Download,
  RefreshCw,
  WifiOff,
  X,
  Laptop,
  ExternalLink,
  FolderArchive,
  CheckCircle2,
  Database,
} from 'lucide-react';
import type { ResidenceRecord } from '../types';
import { downloadLocalBackupJson } from '../lib/dataService';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [inIframe, setInIframe] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    try {
      setInIframe(window.self !== window.top);
    } catch {
      setInIframe(true);
    }

    const userAgent = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(userAgent));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    inIframe,
    install,
  };
}

export const PWAInstallButton: React.FC<{
  variant?: 'sidebar' | 'header';
  records?: ResidenceRecord[];
}> = ({ variant = 'sidebar', records = [] }) => {
  const { isInstallable, isInstalled, isIOS, inIframe, install } = usePWAInstall();
  const [modalOpen, setModalOpen] = useState(false);

  const buttonClass =
    variant === 'header'
      ? 'inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer'
      : 'w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-teal-50 border border-teal-200 text-teal-800 text-xs font-medium rounded-lg hover:bg-teal-100 transition-colors whitespace-nowrap cursor-pointer';

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className={buttonClass}
      >
        <Download className="w-3.5 h-3.5 text-teal-700 shrink-0" />
        <span>Descargar e Instalar Local</span>
      </button>

      {modalOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white border border-slate-200 overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Descargar e Instalar de Manera Local
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Elija instalar como aplicación offline en este equipo o descargar el paquete completo para PC.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer"
                aria-label="Cerrar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Option 1: Install PWA directly */}
              <div className="p-4 border border-slate-200 rounded-lg space-y-3">
                <div className="flex items-start gap-3">
                  <Laptop className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-slate-900">
                      1. Instalar como Aplicación en este Navegador (PWA Offline)
                    </h4>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      Crea un acceso directo en su escritorio o pantalla de inicio y guarda toda la aplicación en caché para trabajar sin internet.
                    </p>
                  </div>
                </div>

                {isInstalled ? (
                  <div className="flex items-center gap-2 text-xs text-emerald-700 font-medium bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>La aplicación ya está instalada y lista para uso offline.</span>
                  </div>
                ) : isInstallable ? (
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await install();
                      if (ok) setModalOpen(false);
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    Instalar App Ahora en este Dispositivo
                  </button>
                ) : (
                  <div className="space-y-2.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md p-3">
                    {inIframe && (
                      <div className="pb-2 border-b border-slate-200">
                        <p className="text-slate-600 mb-2">
                          Para que el navegador habilite la instalación directa de escritorio, abra primero la aplicación en una pestaña independiente:
                        </p>
                        <a
                          href={window.location.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-700 text-white font-medium rounded-md hover:bg-teal-800"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Abrir en Pestaña Independiente
                        </a>
                      </div>
                    )}
                    {isIOS ? (
                      <p>
                        <strong>En iPhone / iPad (Safari):</strong> Pulse <strong>Compartir</strong> y luego seleccione <strong>Agregar a pantalla de inicio</strong>.
                      </p>
                    ) : (
                      <p>
                        <strong>En Chrome / Edge (PC o Android):</strong> Haga clic en el icono <strong>Instalar</strong> en la barra de direcciones o abra el menú <strong>⋮ → Guardar y compartir → Instalar ResiControl</strong>.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Option 2: Download local ZIP package with Windows/Mac/Linux scripts */}
              <div className="p-4 border border-slate-200 rounded-lg space-y-3">
                <div className="flex items-start gap-3">
                  <FolderArchive className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-slate-900">
                      2. Descargar Paquete Instalador Local para PC (.zip)
                    </h4>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      Descarga el programa completo con lanzadores automáticos (<code className="font-mono">INICIAR_WINDOWS.bat</code> y <code className="font-mono">iniciar_mac_linux.sh</code>) y base de datos SQLite local para ejecutarlo sin internet en cualquier computadora.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <a
                    href="/api/download-local"
                    download="ResiControl_Local.zip"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Download className="w-4 h-4" />
                    Descargar Instalador (.zip)
                  </a>

                  {records.length > 0 && (
                    <button
                      type="button"
                      onClick={() => downloadLocalBackupJson(records)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
                    >
                      <Database className="w-3.5 h-3.5 text-teal-700" />
                      Descargar Datos Actuales ({records.length})
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineSyncBanner: React.FC<{
  isOnline: boolean;
  pendingCount: number;
  syncing: boolean;
  onSyncNow: () => void;
}> = ({ isOnline, pendingCount, syncing, onSyncNow }) => {
  if (isOnline && pendingCount === 0) return null;

  return (
    <div
      className={`no-print px-4 sm:px-6 py-2 border-b text-xs flex flex-wrap items-center justify-between gap-2 ${
        !isOnline
          ? 'bg-amber-50 border-amber-200 text-amber-950'
          : 'bg-teal-50 border-teal-200 text-teal-950'
      }`}
    >
      <div className="flex items-center gap-2">
        {!isOnline && <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />}
        <span>
          {!isOnline
            ? 'Modo Offline Activo — Trabajando localmente con base de datos del navegador (IndexedDB). Sus cargas, marcas, exportaciones e informes siguen operando sin internet.'
            : `Conexión restablecida — ${pendingCount} cambio(s) guardado(s) offline listo(s) para sincronizar con el servidor.`}
        </span>
        {pendingCount > 0 && !isOnline && (
          <span className="font-mono tabular-nums font-semibold">
            · {pendingCount} pendiente(s) de sincronizar
          </span>
        )}
      </div>
      {isOnline && pendingCount > 0 && (
        <button
          type="button"
          disabled={syncing}
          onClick={onSyncNow}
          className="inline-flex items-center gap-1.5 px-3 py-1 bg-teal-700 text-white font-medium rounded-md hover:bg-teal-800 cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Sincronizando...' : 'Sincronizar ahora'}
        </button>
      )}
    </div>
  );
};
