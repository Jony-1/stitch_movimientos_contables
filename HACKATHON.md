# Stitch — Plataforma Financiera Agroempresarial

![Astro](https://img.shields.io/badge/Astro-v6.1-BC52EE?logo=astro&logoColor=white)
![Express](https://img.shields.io/badge/Express-v4.19-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-v22-339933?logo=nodedotjs&logoColor=white)

**Stitch** es una plataforma de gestion financiera diseñada especificamente para **empresas agricolas colombianas**. Centraliza movimientos contables, facturas y reportes en un solo lugar, con un **indice de salud financiera de 0 a 100**, alertas inteligentes y pronostico de caja a 30 dias.

> "Visibilidad diaria de caja, cartera y operacion para grupos agricolas."

---

## Problema que resuelve

Las empresas agricolas manejan su contabilidad en hojas de calculo dispersas, sin una vista consolidada de su flujo de caja, cartera vencida o riesgo operativo. Stitch unifica operacion, cartera y movimientos en un panel accionable que permite tomar decisiones con contexto financiero real.

---

## Funcionalidades principales

### Indice Financiero (0-100)
Un indicador compuesto que calcula la salud de la empresa en tiempo real a partir de 4 factores:

| Componente | Peso | Que mide |
|---|---|---|
| Flujo de caja | 0-35 pts | Balance neto vs gastos |
| Cobranza | 0-25 pts | Tasa de facturas cobradas |
| Morosidad | 0-25 pts | Ratio de facturas vencidas |
| Actividad | 0-15 pts | Volumen de movimientos recientes |

**Etiquetas automaticas:** saludable (verde), estable (azul), atencion (amarillo), riesgo (rojo).

### Alertas inteligentes
El sistema genera alertas automaticas con nivel de severidad:

- **Flujo negativo** — proyeccion de caja por debajo de cero
- **Facturas vencidas** — cartera que impacta el flujo
- **Cartera alta** — mas del 35% pendiente por cobrar
- **Baja actividad** — sin movimientos en 30 dias

### Pronostico de caja a 30 dias
Calcula ingresos, egresos y cobros probables usando promedios de los ultimos 3 meses, con un indicador de confianza basado en la cantidad de datos disponibles.

### Multiempresa
Un mismo usuario puede gestionar multiples empresas agricolas desde una sola cuenta, con un **portafolio consolidado** que muestra un semaforo por empresa:

- Verde: indice >= 80
- Amarillo: indice >= 60
- Naranja: indice >= 40
- Rojo: indice < 40

### Movimientos contables
- Registro de ingresos y gastos con categorias agricolas (venta de papa, semillas, abonos, mano de obra, combustible, arriendo de maquinaria, transporte)
- Filtros por tipo
- Edicion y eliminacion
- Tarjetas resumen (total, ingresos, gastos, balance)

### Facturas con detalle de items
- CRUD completo con items de linea (descripcion, cantidad, precio unitario, total automatico)
- Estados: Pendiente, Pagada, Vencida
- Al marcar como pagada, se crea automaticamente un movimiento contable de tipo "Cuentas por cobrar"
- Filtros inteligentes: todas, pagada, pendiente, vencida, vence en 7 dias, alto monto
- Panel de detalle con acciones (editar, pagar, imprimir PDF)
- "Urgencia de cartera" y "Accion recomendada" dinamicas

### Reportes financieros
- Filtros por rango de fechas y tipo de movimiento
- Desglose por categoria con barras horizontales
- Tendencia mensual de ingresos vs gastos
- Distribucion de facturas por estado y por contraparte
- Tablas completas de movimientos y facturas incluidas
- **Exportacion CSV** (resumen + detalle)
- **Exportacion PDF** (generado en servidor con pdfkit)

### Gestion de usuarios y roles
- Roles: Administrador, Productor, Contador (lectura)
- CRUD de miembros por empresa
- Roles por organizacion (owner, accountant, manager)

### Modo oscuro completo
- Deteccion automatica de preferencia del sistema
- Toggle manual con persistencia en localStorage
- Transiciones suaves entre temas
- Todos los componentes adaptados

### Diseño responsive
- Tablas se convierten en cards en movil
- Sidebar colapsable con overlay
- Grids adaptativos
- Prevencion de zoom en iOS (font-size: 16px)

---

## Stack tecnologico

### Frontend
| Tecnologia | Uso |
|---|---|
| **Astro v6.1** | Generador de paginas estaticas |
| **Tailwind CSS v4.2** | Estilos utilitarios |
| **Vite** | Bundler y dev server |
| **Material Symbols** | Sistema de iconos |
| **Manrope** | Tipografia principal |

### Backend
| Tecnologia | Uso |
|---|---|
| **Node.js v22** | Runtime |
| **Express v4.19** | Servidor HTTP y API REST |
| **PostgreSQL** | Base de datos relacional |
| **bcryptjs** | Hash de contrasenas |
| **express-session** | Gestion de sesiones |
| **pdfkit** | Generacion de PDFs en servidor |

### DevOps
| Tecnologia | Uso |
|---|---|
| **Docker** | Contenedorizacion (node:22.14.0) |
| **nodemon** | Recarga automatica del API |
| **concurrently** | Ejecucion simultanea frontend + backend |

---

## Arquitectura

```
/
├── server.js                  # Express: API REST + servir paginas + PDF
├── db.js                      # Pool de PostgreSQL con SSL
├── middleware/security.js     # CSRF, autenticacion, headers de seguridad
├── src/
│   ├── pages/                 # 9 paginas Astro (landing, auth, app)
│   ├── layouts/               # AppLayout (sidebar), AuthLayout
│   ├── components/            # Head, Sidebar, AppHeader
│   ├── scripts/               # Logica del frontend (ESM)
│   └── styles/global.css      # Variables CSS, temas, componentes surface
├── assets/styles.css          # Estilos de tablas responsive
├── Dockerfile                 # Despliegue en contenedor
└── dist/                      # Build de Astro
```

**Patron hibrido:** Astro genera HTML estatico en `dist/`, Express sirve esas paginas y la API REST. Frontend y backend comparten el mismo origen.

---

## Base de datos

| Tabla | Descripcion |
|---|---|
| `users` | Usuarios con roles (Admin, Contador, Productor) |
| `organizations` | Empresas agricolas |
| `organization_memberships` | Relacion usuario-empresa con rol |
| `movements` | Ingresos y gastos contables |
| `invoices` | Facturas con estado y fechas |
| `invoice_items` | Lineas de detalle de cada factura |

Todas las consultas usan **parametros SQL** (`$1`, `$2`) para seguridad. Los datos estan **scoped por organizacion** (multi-tenant).

---

## API REST

| Recurso | Endpoints |
|---|---|
| Auth | `POST /api/login`, `POST /api/register`, `POST /api/logout`, `GET /api/me` |
| Movimientos | `GET/POST /api/movements`, `PUT/DELETE /api/movements/:id` |
| Facturas | `GET/POST /api/invoices`, `PUT/DELETE /api/invoices/:id`, `POST /api/invoices/:id/pay` |
| Reportes | `GET /api/reports/overview`, `GET /api/reports/overview/csv`, `GET /api/reports/overview/pdf` |
| Inteligencia | `GET /api/copilot/summary`, `GET /api/portfolio/overview` |
| Usuarios | `GET/POST /api/users`, `PUT/DELETE /api/users/:id` |
| Sesion | `GET /api/csrf`, `POST /api/session/active-organization` |

Proteccion CSRF en todos los endpoints de escritura con auto-retry en el frontend.

---

## Seguridad

- Contrasenas hasheadas con **bcryptjs**
- **Tokens CSRF** en todas las peticiones de escritura
- **Headers de seguridad**: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS (produccion)
- Consultas SQL **parametrizadas** (sin interpolacion de datos)
- Guards de autenticacion: `ensureAuth`, `ensureAdmin`, `ensureApiAuth`, `ensureAdminApi`
- Modo lectura para rol Contador

---

## Como ejecutar

```bash
# Instalar dependencias
npm install

# Configurar variables de entorno
# .env: DATABASE_URL, SESSION_SECRET, PORT

# Modo desarrollo (frontend + backend simultaneo)
npm run dev

# Modo produccion
npm start
```

La aplicacion escucha en el puerto configurado (default: 3000).

---

## Credenciales de prueba

| Rol | Email | Contrasena |
|---|---|---|
| Administrador | admin@example.com | admin123 |

---

## Lo que hace especial a Stitch

1. **Indice financiero 0-100** — no es solo un reporte, es un diagnostico accionable
2. **Alertas automaticas** — el sistema te dice que necesita atencion hoy
3. **Pronostico de caja** — proyeccion simple, clara y explicable
4. **Multiempresa** — un solo panel para toda tu operacion agricola
5. **Facturas conectadas a contabilidad** — al pagar una factura se crea el movimiento automaticamente
6. **PDF y CSV** — exporta lo que necesites para compartir con tu equipo o contador
7. **Modo oscuro** — porque a veces la caja se revisa de noche

---

## Equipo

Desarrollado como proyecto para hackaton por el equipo de Stitch.

---

*"Menos dispersion operativa. Mas control financiero."*
