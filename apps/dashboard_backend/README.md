# Dashboard Backend (Tezvix OS)

Dedicated Node.js & MongoDB backend providing real-time database monitoring, operations telemetry, store settings synchronization, and role-based access control (RBAC) for the Tezvix OS checkout dashboard.

---

## Features

- **Real-Time Database Monitoring**:
  - Live inspection of MongoDB collections, storage footprint, and indexes.
  - Real-time checkout event telemetry (`started`, `logged_in`, `address_added`, `discount_applied`, `checkout_completed`, `checkout_abandoned`).
  - Order attempt tracking (`checkoutOrderAttempts`) with failure rate analysis and revenue calculations.
  - Funnel conversion and cart abandonment analytics.
- **Enterprise Authentication & RBAC**:
  - JWT authentication with bcrypt password hashing.
  - 4 Role Tiers:
    - `SUPER_ADMIN`: Full access to database, monitoring, users, and audit logs.
    - `ADMIN`: Operational monitoring, orders, settings, and team management.
    - `OPERATOR`: Monitoring, viewing orders, and triggering reconciliations.
    - `VIEWER`: Read-only telemetry and analytics.
- **Dashboard Compatibility**:
  - Direct drop-in replacement for dashboard settings (`GET`/`PUT /api/settings`) and funnel analytics (`GET /api/analytics`), eliminating proxy errors when running the dashboard.
- **Security & Auditability**:
  - Automatic audit trail logging for sensitive user operations.
  - Input sanitization and schema validation via Zod.

---

## Quick Start

### 1. Install & Build

```bash
# From apps/dashboard_backend
npm run typecheck
npm run build
```

### 2. Run in Development Mode

```bash
npm run dev
```

The server starts on `http://localhost:3001` (default) and connects to MongoDB.

### 3. Default Credentials

On first launch, an initial `SUPER_ADMIN` account is seeded automatically:

- **Email:** `admin@tezvix.internal`
- **Password:** `Admin@123456`

_(Configure via `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` in `.env`)_

---

## API Reference

### Authentication (`/api/auth`)

| Method | Path                        | Access            | Description                                          |
| ------ | --------------------------- | ----------------- | ---------------------------------------------------- |
| `POST` | `/api/auth/login`           | Public            | Authenticate with email/password; returns JWT + User |
| `POST` | `/api/auth/register`        | Admin / First-run | Register new team user                               |
| `GET`  | `/api/auth/me`              | Authenticated     | Retrieve current user profile and permissions        |
| `POST` | `/api/auth/change-password` | Authenticated     | Update current user's password                       |

### Database Monitoring (`/api/monitor`)

| Method | Path                             | Access         | Description                                                                             |
| ------ | -------------------------------- | -------------- | --------------------------------------------------------------------------------------- |
| `GET`  | `/api/monitor/overview`          | `monitor:read` | Health status, DB storage stats, order attempts summary, revenue, and live event stream |
| `GET`  | `/api/monitor/stats`             | `monitor:read` | MongoDB `serverStatus` and `db.stats` breakdown                                         |
| `GET`  | `/api/monitor/collections`       | `monitor:read` | List all collections, document counts, and indexes                                      |
| `GET`  | `/api/monitor/collections/:name` | `monitor:read` | Inspect collection documents and schema sample                                          |
| `GET`  | `/api/monitor/live-events`       | `monitor:read` | Stream and filter recent shopper checkout events                                        |

### Orders & Reconciliation (`/api/orders`)

| Method | Path                          | Access         | Description                                            |
| ------ | ----------------------------- | -------------- | ------------------------------------------------------ |
| `GET`  | `/api/orders`                 | `orders:read`  | Query checkout order attempts with status/shop filters |
| `GET`  | `/api/orders/:id`             | `orders:read`  | Detailed attempt info, idempotency key, error messages |
| `POST` | `/api/orders/:id/flag-review` | `orders:write` | Flag attempt for manual review                         |

### Store Settings & Analytics (`/api/settings`, `/api/analytics`)

| Method | Path             | Access             | Description                                         |
| ------ | ---------------- | ------------------ | --------------------------------------------------- |
| `GET`  | `/api/settings`  | Public / Dashboard | Fetch store checkout payment flags and brand config |
| `PUT`  | `/api/settings`  | Public / Dashboard | Update store checkout payment methods               |
| `GET`  | `/api/analytics` | Public / Dashboard | Funnel drop-offs and abandoned cart sessions        |

### User Management (`/api/users`)

| Method   | Path                    | Access         | Description                              |
| -------- | ----------------------- | -------------- | ---------------------------------------- |
| `GET`    | `/api/users`            | `users:read`   | List all system accounts                 |
| `POST`   | `/api/users`            | `users:manage` | Create new operator/viewer/admin account |
| `PATCH`  | `/api/users/:id/role`   | `SUPER_ADMIN`  | Change user role                         |
| `PATCH`  | `/api/users/:id/status` | `users:manage` | Activate/Deactivate user                 |
| `DELETE` | `/api/users/:id`        | `SUPER_ADMIN`  | Remove user account                      |

### Audit Logs (`/api/audit-logs`)

| Method | Path              | Access       | Description                                     |
| ------ | ----------------- | ------------ | ----------------------------------------------- |
| `GET`  | `/api/audit-logs` | `audit:read` | View security actions and user operations trail |
