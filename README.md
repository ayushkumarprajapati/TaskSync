# TaskSync

A student portfolio project for collaborative task management.

TaskSync includes a React + Vite frontend and a Node.js + Express REST API,
with MySQL persistence and JWT authentication. Register, sign in, and manage
tasks through a dashboard with counts, assignment, filters, search, and
authenticated Socket.IO live updates.

## Requirements

- Node.js 22.12 or newer (Node.js 24 LTS recommended)
- npm, included with Node.js
- MySQL 8 or newer, installed and running

## Project structure

```text
TaskSync/
├── client/             # React + Vite frontend
│   ├── src/
│   ├── index.html
│   └── vite.config.js
├── server/             # Express REST API
│   ├── src/
│   │   ├── app.js       # Express app and health endpoint
│   │   ├── config/db.js # MySQL connection pool
│   │   └── server.js    # Environment setup and HTTP listener
│   └── .env.example
├── database/schema.sql # Database and table definitions
└── README.md
```

## Start the backend

Open a terminal in the project root:

```powershell
cd server
npm install
Copy-Item .env.example .env
npm run db:init
npm run db:check
npm run dev
```

On macOS/Linux, use `cp .env.example .env` for the copy step. Copy the file only
on first setup; preserve your existing `.env` on later runs.

Before running `db:init`, edit `server/.env` with your MySQL host, port, user,
and password. A fresh copy of `.env.example` contains a placeholder password;
replace it before connecting. Keep `DB_NAME=tasksync` to match the schema. `.env` is
ignored by Git; `.env.example` is safe to commit because it contains no secrets.

Set `JWT_SECRET` to a random secret of at least 32 characters. An ignored local
`.env` already has a generated secret for this workspace. On a fresh setup,
generate one with the following command and paste its output into `.env`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep the secret private. Changing it invalidates previously issued tokens.
The server can start without MySQL, but registration, login, and authenticated
profile queries return HTTP 503 until the database is configured.

### When you are ready to configure MySQL

1. Install [MySQL Community Server](https://dev.mysql.com/downloads/mysql/)
   for Windows and configure it as a running service. Set a local database
   password during configuration. MySQL Workbench is optional for browsing
   tables; it does not replace the database server.
2. Update `DB_HOST`, `DB_PORT`, `DB_USER`, and `DB_PASSWORD` in `server/.env`
   to match that installation. Keep `DB_NAME=tasksync`. Do not share or commit
   your password.
3. From `server/`, run `npm run db:init` and `npm run db:check`.
4. Repeat registration, login, and the protected profile request in Postman
   to verify real persistence.

`npm run db:init` executes `database/schema.sql` through mysql2. The MySQL user
must have permission to create the database and tables. The script uses
`IF NOT EXISTS`, so it does not drop existing tables or erase data; it also does
not migrate existing table definitions. You can alternatively open the SQL
file in MySQL Workbench and execute it there.

`npm run db:check` verifies the connection with `SELECT 1`. The HTTP health
endpoint checks the Express server only; use this command to check MySQL.

Backend code can import the pool from `src/config/db.js` and use
`pool.execute('SELECT id, name FROM users WHERE id = ?', [userId])`.
Use placeholders for user input. The pool reuses connections and supports
`async`/`await`. Controllers use parameterized queries for all user input.

## Database schema

`users` stores each user's name, unique email, password hash, and creation time.
The requested `password` column must hold a hash, never a plain-text password.
Registration hashes passwords with bcrypt before storing them.

`tasks` stores task details, status, priority, optional due date, and timestamps.
Each task has a required creator and an optional assignee, both referencing
`users.id`. A user can create or be assigned many tasks. Status defaults to
`todo`; priority defaults to `medium`.

Deleting an assignee sets `assigned_to` to NULL. Deleting a user who created
tasks is blocked to preserve ownership. Task deletion does not delete users.
Indexes on the two user references support filtering by creator and assignee.
`updated_at` automatically changes when stored task values change.

The tables use InnoDB for foreign-key enforcement and `utf8mb4` for Unicode,
including emoji. Database constraints enforce relationships; the API enforces
task visibility and ownership rules.

The API starts at http://localhost:5000. Node's built-in watch mode restarts it when source files
change. `npm start` runs the server without automatic restarts.

To verify it, open http://localhost:5000/api/health in a browser or send a GET
request in Postman. Expected response:

```json
{
  "status": "ok",
  "message": "TaskSync API is running"
}
```

## Start the frontend

Open a second terminal in the project root:

```powershell
cd client
npm install
npm run dev
```

Open http://localhost:5173 to sign in or create an account. Keep both terminals running
during development.

Registration sends your details to Express and then redirects to sign in.
After login, the protected dashboard loads your task list and status counts.
The JWT is stored in `sessionStorage` for the current browser tab and is checked
against `/api/auth/me` after reload. Sign out clears it; token expiry returns
you to sign in. If MySQL is temporarily unavailable, a retry screen preserves
the session instead of silently signing you out. Browser storage is accessible
to same-origin JavaScript, so keep scripts trusted and avoid rendering raw user HTML.

Navigation uses a small hash-based page switch (`#/login`, `#/register`, and
`#/dashboard`) without an additional routing dependency.

## Using the dashboard

- Create a task with a title, optional description, priority, optional due date,
  and optional assignee. All registered users appear in the assignee dropdown;
  select yourself to put a task in your own assigned list.
- Every authenticated user can view all workspace tasks. Teams and shared
  projects are outside this version; there is one shared workspace.
- The creator can edit task details, reassign a task, or delete it after
  confirmation. The creator and assignee can change status. Reassignment
  removes the previous assignee's status-update permission unless they are
  also the creator. They can still view the task.
- Filter by status, priority, or a registered assignee, switch to Assigned to me, or search task titles
  and press Search. Filters combine. Clear filters resets the list.
- Dashboard counts always cover all tasks visible to you, independent of the
  active list filters. Completed tasks are counted once even when you are both
  creator and assignee.
- Dates are stored as calendar dates, not converted between time zones. A task
  is marked overdue after the end of its due date in your browser's local time,
  unless it is done.

Tasks persist in MySQL across refreshes and server restarts. Connected dashboards
automatically reload their current SQL-filtered list and shared counts when a
task changes. Existing filters and open task forms are preserved.

Vite forwards frontend requests beginning with `/api` to
`http://localhost:5000`. For example, a future `fetch('/api/health')` call will
reach Express through this development proxy. If you change the backend port,
also update the proxy target in `client/vite.config.js`.
Vite also proxies `/socket.io` (HTTP polling and WebSocket upgrades) to the same
backend port. No additional server or port is needed.

## Build the frontend

From `client/`:

```powershell
npm run build
npm run preview
```

The build is written to `client/dist/`. Preview serves the frontend build
locally; it does not start the backend or provide the development API proxy.
Production API hosting will be configured later.

## Dependencies

- Frontend: `react`, `react-dom`, `socket.io-client`; development tools: `vite`, `@vitejs/plugin-react`.
- Backend: `express`, `dotenv`, `mysql2`, `bcrypt`, `jsonwebtoken`, `socket.io`; Node's built-in watch mode handles development restarts. The server's development dependency `socket.io-client` supports integration tests.

Each app has its own `package.json` and lockfile. Use `npm ci` instead of
`npm install` for a clean install of the locked dependency versions.

## Authentication API and Postman testing

Start the backend with `npm run dev` from `server/`.

1. Send `POST http://localhost:5000/api/auth/register` with a JSON body:

   ```json
   { "name": "Student", "email": "student@example.com", "password": "StudentPass123!" }
   ```

   Expect HTTP 201 and a public user object. Name is required (up to 100
   characters); email must be valid (up to 255 characters). Passwords require
   at least 8 characters and at most 72 UTF-8 bytes, bcrypt's input limit.
   Names are trimmed, and emails are trimmed and lowercased. Passwords are
   preserved exactly. Duplicate email addresses return HTTP 409.

2. Send `POST http://localhost:5000/api/auth/login` with email and password.
   Expect HTTP 200 with a `token`, `tokenType`, `expiresIn`, and public `user`.
   Wrong credentials return HTTP 401 with the same message for unknown emails
   and incorrect passwords.

3. Send `GET http://localhost:5000/api/auth/me`. In Postman's Authorization tab,
   choose Bearer Token and paste the login token. Expect the current user.
   Without a token, with a modified token, or after expiry, expect HTTP 401.

JWTs carry the user ID in `sub` and expire after one hour. Middleware verifies
the signature and expiry, then sets `req.user.id`. `/api/auth/me` is private;
registration, login, and health checks are public. All task endpoints and the
user assignment directory also require JWT middleware. Task controllers then
check creator/assignee access for each operation.

Errors follow `{ "error": { "message": "..." } }`. Registration validation
errors also include `error.fields`. Password hashes, SQL errors, and stack
traces are not included in responses.

Run `npm test` from `server/` for HTTP tests using real bcrypt and JWT operations
and an isolated in-memory substitute for database queries. These tests do not
require MySQL and do not verify the SQL schema or persistence. Repeat the
Postman flow against MySQL after installing the server and applying the schema.

For an automated check against your real MySQL database, run `npm run test:mysql`
from `server/`. It creates a uniquely named temporary account, verifies password
hashing, duplicate prevention, login, and protected profile access, then deletes
only that temporary account. It requires a configured `.env` and initialized schema.

## Task REST API

All these endpoints require `Authorization: Bearer <token>`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/users` | Names and IDs for assignment |
| GET | `/api/tasks` | Accessible tasks, newest first |
| GET | `/api/tasks/summary` | Accessible task counts by status |
| GET | `/api/tasks/:id` | One accessible task |
| POST | `/api/tasks` | Create a task (initial status: todo) |
| PUT | `/api/tasks/:id` | Creator replaces editable details |
| PATCH | `/api/tasks/:id/status` | Creator or assignee changes status |
| DELETE | `/api/tasks/:id` | Creator deletes a task |

Example create or edit body:

```json
{
  "title": "Prepare interview demo",
  "description": "Explain the architecture and permissions",
  "priority": "high",
  "assigned_to": null,
  "due_date": "2027-01-15"
}
```

Use a registered user's numeric ID for `assigned_to`, or `null` to unassign.
The server takes `created_by` from the JWT, never the submitted body. Edit uses
PUT: send all editable details; omitted optional fields reset to their defaults.
Status changes use a separate body such as `{ "status": "in_progress" }`.
Statuses are `todo`, `in_progress`, and `done`; priorities are `low`, `medium`,
and `high`. Optional due dates must be valid `YYYY-MM-DD` dates. Description is
limited to MySQL TEXT's 65,535 UTF-8 bytes. Task titles require 1–200 characters.

Example combined query:
`/api/tasks?status=todo&priority=high&assignedTo=me&search=interview`.
`assignedTo=42` filters by a specific registered user's ID. This extends the
existing `assignedTo=me` parameter; no parameters still returns all accessible
tasks with the same response shape and newest-first ordering. The assignee
filter applies to the shared workspace. Search is a literal substring of the
title. Reads require authentication; missing task IDs return 404. Non-creators
receive 403 for edits/deletion, and users who are neither creator nor assignee
receive 403 for status updates. These checks happen on the backend, including
ownership conditions in SQL writes.

Import `postman/TaskSync.postman_collection.json` into Postman. Run Register,
Login, and Create task in order. Login stores the token as a collection variable;
Create task stores the task ID for subsequent requests. Use a different email
for a second account to test assignment permissions. The Delete request is
deliberately labeled destructive and should be run only for a disposable task.

Run `npm run test:tasks` from `server/` for real MySQL HTTP checks covering task
CRUD, creator/assignee/viewer permissions, combined filters, counts, invalid
input, and status-permission revocation after reassignment. Only the accounts and tasks
created by that test are removed afterward.

## Task filter indexes and EXPLAIN

Filtering happens in SQL, not by loading all tasks and filtering in React.
New databases get the filter indexes through `schema.sql`. For an existing
installation, run `npm run db:indexes` from `server/`; this checks existing
definitions and adds only missing indexes without changing task data.
`db:init` alone does not alter an existing table.

Run `npm run explain:filters` from `server/` to reproduce the isolated
before/after comparison. It uses the endpoint's query builder, creates two
uniquely named scratch tables with synthetic data, and removes them afterward.
It writes full plans to `database/filter-explain-results.json` without copying
real user or task data. Requires MySQL 8.0.18+ (`EXPLAIN ANALYZE` support), plus
CREATE/ALTER/DROP and ordinary read/write permissions for the scratch tables.
See [PERFORMANCE.md](PERFORMANCE.md) for observations and limits.

## Real-time events and authorization

| Action | Creator | Assignee | Other authenticated user |
| --- | --- | --- | --- |
| Read tasks | Yes | Yes | Yes |
| Edit details / reassign / delete | Yes | No | No |
| Change status | Yes | Yes | No |

Any authenticated user can create a task. The server always assigns its creator
from the verified JWT. Client button visibility is only a convenience; forged
REST requests are still rejected by task controllers.

Event flow:

1. After login, the browser connects to Socket.IO with its JWT in `auth.token`.
2. Socket middleware verifies the JWT and that the account exists, then joins
   the socket to the authenticated room. Missing, invalid, and expired tokens
   are rejected. A connected socket is disconnected at token expiry.
3. Create/edit/status/delete actions continue using the existing REST endpoints.
   Express verifies the JWT; controllers check permissions and validate input.
4. Only after a successful MySQL write, the controller broadcasts
   `tasks:changed` with `{ "action": "created", "taskId": 123 }`.
   Other action values are `updated`, `status_updated`, and `deleted`.
5. All authenticated sockets receive the notification, including the author.
   Browsers debounce notifications briefly, then fetch the filtered list,
   shared counts, and assignment directory through REST. MySQL remains the
   source of truth; socket messages carry no password, JWT, or task contents.

There are no client-to-server task mutation or rebroadcast handlers. Emitting
fake task events from a browser cannot write to MySQL or notify other clients.
Socket authentication uses [connection middleware](https://socket.io/docs/v4/middlewares/).

The dashboard refetches on every socket connection/reconnection to catch changes
missed while offline. It shows connection state and provides Refresh tasks as a
fallback. Socket authentication failures sign the user out; temporary service
failures retry. Signing out/unmounting removes listeners and disconnects.
This is a single-process setup, with no event history, durable event delivery,
or multi-server adapter. Socket.IO's default delivery does not replay events
missed during a disconnect ([documentation](https://socket.io/docs/v4/tutorial/handling-disconnections)).

For a manual check, sign into two tabs with different accounts, leave both on
the dashboard, and create/edit/change status/delete a disposable task in the
creator's tab. The other tab updates without a page reload. Give the second
user an assignment to enable its status control. Otherwise it shows View only.
Changing filters still uses SQL and is reapplied after each notification.

Run `npm run test:realtime` from `server/` for real MySQL and Socket.IO checks:
three user roles, WebSocket/polling clients, all four broadcasts, failed writes
with no broadcasts, ignored fake events, reconnect/resync, and JWT expiry.
Temporary test users/tasks are removed afterward.

## Authentication abuse protection and account removal

Registration and login are rate-limited before their controllers run. Over a
15-minute window, registration allows 10 attempts per IP, login allows 30 total
attempts per IP, and each normalized email allows 10 failed login attempts
across IPs. Successful logins do not consume the failed-account budget. Blocked
requests return HTTP 429 with the usual JSON error shape and a `Retry-After`
header. Wait until that window resets before trying again.

Limits use the process-local memory store, matching the single-server setup;
they reset on restart and are not shared across replicas. If deploying behind
a reverse proxy, set `TRUST_PROXY_HOPS` to the verified trusted proxy count.
Keep its default `0` for direct/local connections. Do not blindly trust arbitrary
forwarded client-IP headers or set trust proxy to true. See the limiter's
[proxy guidance](https://express-rate-limit.mintlify.app/guides/troubleshooting-proxy-issues).

Every private REST request now checks that the JWT's account still exists.
Removing an account from MySQL causes subsequent private requests to return
401 and disconnects any sockets belonging to that user when such a request is
made. Socket handshakes continue to reject removed accounts as well.

Before each task broadcast, the server rechecks connected accounts in one
batched query and disconnects removed/expired recipients before sending the
event. A separate batched check runs every 30 seconds to remove idle sessions
even when no tasks change. If database authorization cannot be checked, no
task notification is sent; existing accounts are not logged out merely because
the database is unavailable. Normal REST database failures remain 503.

The server has no user-deletion API; these checks also cover administrative
account removal in MySQL. Existing foreign-key rules still prevent deleting a
user who owns tasks. `npm test` includes rate-limit and deleted-account/session
regressions without needing MySQL; `npm run test:realtime` also verifies actual
MySQL account deletion while a socket is connected.
