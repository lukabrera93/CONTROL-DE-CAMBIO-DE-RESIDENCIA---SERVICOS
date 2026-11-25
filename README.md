# ResiControl — Gestión de Planillas de Cambio de Residencia

Aplicación web full-stack para carga de planillas Excel (`CAMBIO DE RESIDENCIA`), seguimiento nominal de estados (**Realizado**, **Pendiente**, **De otro departamento**), detección automática de duplicados, exportación fiel al formulario oficial para remisión por correo, gráficos de avance mensual en tiempo real, respaldos locales y monitoreo operativo del servidor.

## Requisitos previos
- Node.js >= 22.14 (utiliza `node:sqlite` nativo y ejecución directa de TypeScript)
- npm >= 10

## Desarrollo local
```bash
npm install
npm run dev
```
La aplicación se iniciará en `http://localhost:3000`.

## Compilación y producción
```bash
npm run lint
npm run build
NODE_ENV=production npm start
```

## Sincronización con GitHub y CI/CD
Este repositorio incluye `.github/workflows/ci-cd.yml` y `Dockerfile` listos para integración y despliegue continuo:
```bash
git init
git add .
git commit -m "Versión inicial ResiControl"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/resicontrol.git
git push -u origin main
```
Cada `push` a `main` ejecuta automáticamente:
1. Validación de tipos TypeScript (`npm run lint`)
2. Compilación de producción (`npm run build`)
3. Verificación de salud y base de datos (`/api/health` y `/api/ready`)
4. Despliegue automático en GitHub Pages o contenedor Docker / Cloud Run.
