import React, { useState } from 'react';
import {
  GitBranch,
  CheckCircle2,
  Copy,
  Check,
  Activity,
  Container,
  Workflow,
} from 'lucide-react';

export const CicdView: React.FC = () => {
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [healthStatus, setHealthStatus] = useState<{
    health?: string;
    ready?: string;
    checking: boolean;
  }>({ checking: false });

  const gitCommands = `git init
git add .
git commit -m "Versión inicial ResiControl"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/resicontrol.git
git push -u origin main`;

  const runHealthCheck = async () => {
    setHealthStatus({ checking: true });
    try {
      const [hRes, rRes] = await Promise.all([
        fetch('/api/health').then((r) => r.json()),
        fetch('/api/ready').then((r) => r.json()),
      ]);
      setHealthStatus({
        health: `${hRes.status.toUpperCase()} (${hRes.uptimeSeconds}s activo)`,
        ready: rRes.ready ? `LISTO (${rRes.database})` : 'NO DISPONIBLE',
        checking: false,
      });
    } catch {
      setHealthStatus({
        health: 'ERROR DE CONEXIÓN',
        ready: 'NO DISPONIBLE',
        checking: false,
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* GitHub Sync Guide */}
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <GitBranch className="w-5 h-5 text-teal-700" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Sincronización con GitHub y Control de Versiones
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Repositorio preparado con flujo de CI/CD automático y despliegue reproducible
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(gitCommands);
              setCopiedCmd(true);
              setTimeout(() => setCopiedCmd(false), 2000);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            {copiedCmd ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedCmd ? 'Comandos copiados' : 'Copiar comandos Git'}
          </button>
        </div>

        <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
          {gitCommands}
        </pre>
      </div>

      {/* Included CI/CD & High Availability Architecture */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-3">
            <Workflow className="w-4 h-4 text-teal-700" />
            <h3 className="text-sm font-semibold text-slate-900">
              Integración Continua (.github/workflows/ci-cd.yml)
            </h3>
          </div>
          <ul className="space-y-2 text-xs text-slate-600">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span>Verificación automática de TypeScript (<code className="font-mono">npm run lint</code>) en cada push y pull request.</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span>Compilación de producción con Vite (<code className="font-mono">npm run build</code>) y prueba de arranque real del servidor.</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span>Despliegue automático a GitHub Pages desde la rama <code className="font-mono">main</code>.</span>
            </li>
          </ul>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-3">
            <Container className="w-4 h-4 text-teal-700" />
            <h3 className="text-sm font-semibold text-slate-900">
              Alta Disponibilidad (Dockerfile)
            </h3>
          </div>
          <ul className="space-y-2 text-xs text-slate-600">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span>Imagen multi-etapa en Node 22 Slim optimizada para Cloud Run, Railway, Fly.io o Docker Swarm.</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span>Volumen persistente <code className="font-mono">/app/data</code> para la base de datos SQLite en modo WAL.</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span>Sonda <code className="font-mono">HEALTHCHECK</code> integrada cada 30 segundos para reinicio y escalado automático.</span>
            </li>
          </ul>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-teal-700" />
              <h3 className="text-sm font-semibold text-slate-900">
                Verificación de Endpoints de Producción
              </h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Pruebe en vivo las rutas <code className="font-mono">/api/health</code> y <code className="font-mono">/api/ready</code> utilizadas por los balanceadores de carga.
            </p>
            {healthStatus.health && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-xs font-mono space-y-1 mb-4">
                <div>
                  /api/health: <span className="text-emerald-700 font-semibold">{healthStatus.health}</span>
                </div>
                <div>
                  /api/ready: <span className="text-emerald-700 font-semibold">{healthStatus.ready}</span>
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={healthStatus.checking}
            onClick={runHealthCheck}
            className="w-full px-4 py-2 bg-teal-700 text-white text-xs font-medium rounded-lg hover:bg-teal-800 cursor-pointer disabled:opacity-50"
          >
            {healthStatus.checking ? 'Verificando...' : 'Ejecutar Test de Disponibilidad'}
          </button>
        </div>
      </div>
    </div>
  );
};
