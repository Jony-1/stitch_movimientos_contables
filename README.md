# Stitch - Movimientos contables

Migración progresiva a Astro con backend Express + PostgreSQL.

## Estado actual
- UI principal en Astro
- Express sirve la API y entrega `dist/`
- Login y registro de productores ya están conectados; el alta crea una cuenta activa y entra al dashboard
- Movimientos, facturas, reportes, usuarios y configuración ya están conectados
- Facturas con ítems: CRUD, detalle, filtros por estado, vencimiento y total automático

## Cómo correr
```powershell
npm install
npm run dev
```

## Build y arranque
```powershell
npm run build:web
npm start
```

## Variables
- `DATABASE_URL`
- `SESSION_SECRET`
- `PORT`
- `PUBLIC_API_BASE_URL` opcional para Astro en dev

## MVP por fases
1. Base y limpieza: quitar legados, ordenar scripts y docs.
2. Auth estable: login/logout, sesión y errores visibles.
3. Datos reales: listas, CRUD y edición en pantallas clave.
4. Calidad: validaciones, mensajes vacíos, loading y permisos.
5. Producción: despliegue, sesiones, rutas y checklist final.

## Próximos pasos recomendados
- Validar formularios en backend antes de guardar.
- Exportación PDF y numeración fiscal cuando toque formalizar facturas.
- Preparar una página de despliegue con pasos concretos.

## Checklist de producción
- Ejecutar `npm run build:web`
- Verificar `npm start` con `DATABASE_URL` real
- Confirmar `SESSION_SECRET` definido
- Probar login, logout y rutas protegidas
- Revisar que `dist/` se sirva correctamente
- Probar crear/editar/eliminar en movimientos, facturas y usuarios
