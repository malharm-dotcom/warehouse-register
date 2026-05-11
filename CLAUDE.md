# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Snitch WH Attendance System — a single-page web application for warehouse attendance tracking at Snitch. Supervisors mark daily attendance per department; managers view department submission status and approve attendance rewrite requests.

## Project Structure

The application is intentionally minimal:

- **`index (5).html`** — The entire frontend: all HTML, CSS, and JavaScript in one file (~2600 lines). This is the only deliverable served to users.
- **`package.json`** — Node.js package file with `express`, `pg`, `cors`, `dotenv` dependencies. The referenced `index.js` backend does not yet exist.
- **`node_modules/`** — Installed dependencies (express, pg, cors, dotenv).

## Architecture

### Frontend (index (5).html)

All application logic is inline in a single HTML file. There is no build step, no bundler, and no framework.

**Three screens** (toggled via `.screen`/`.screen.active` CSS classes):
- `#login-screen` — Name dropdown search + PIN authentication for both roles
- `#app-screen` — Supervisor view: mark attendance, history table, history matrix
- `#mgr-screen` — Manager view: pending rewrite requests, today's department status, manager matrix

**Global state variables** at the top of the `<script>` block (`session`, `employees`, `submissionState`, `currentShift`, etc.).

**`CFG` object** at the top of the script holds all API endpoint URLs (n8n webhooks).

### Backend / API

All data operations go through **n8n workflow webhooks** at `n8n.snitch-workflow.com`. There is no local Express server currently. The `package.json` dependencies are for a future server-side component.

Key webhook endpoints:
| Variable | Purpose |
|---|---|
| `AUTH_LOGIN_URL` | Authenticate by name + PIN |
| `GET_EMPLOYEES_URL` | Fetch employees for a department |
| `SUBMIT_URL` | Submit attendance for the day |
| `CHECK_SUBMISSION_URL` | Check if attendance already submitted |
| `REWRITE_REQUEST_URL` | Request correction to past attendance |
| `GET_HISTORY_URL` | Daily attendance history |
| `GET_HISTORY_RANGE_URL` | Date-range history + matrix view |
| `GET_REQUESTS_URL` | Fetch rewrite requests (manager) |
| `HANDLE_APPROVAL_URL` | Approve/reject rewrite requests (manager) |
| `TODAY_STATUS_URL` | Per-department submission status (manager) |

### User Roles

**Supervisor** — logs in with name + PIN, selects Day or Night shift, marks attendance for their department's employees, can request rewrites for past dates.

**Manager** — logs in with name + PIN, reviews and approves rewrite requests in bulk or individually, views all departments' today-status summary and a cross-department matrix.

### Key Enums

**Attendance statuses:** `present`, `absent`, `week-off`, `sick-leave`, `planned-leave`, `unplanned-leave`

**Departments:** `B2B Forward`, `B2B Return`, `B2C Forward`, `B2C Return`, `Inventory`, `Inward`, `Logistics`, `Ops`, `Admin`

**Shifts:** `Day`, `Night`

### Session Persistence

Sessions are stored in `sessionStorage` under:
- `snitch_session` — supervisor session
- `snitch_manager_session` — manager session

## Development

Since there is no build system, open `index (5).html` directly in a browser or serve it with any static file server:

```
npx serve .
```

To run with the planned Express backend (once `index.js` is created):

```
node index.js
```

## CSS / Design Tokens

All colors and spacing are CSS custom properties on `:root` in the `<style>` block at the top of the HTML file. Key tokens: `--accent` (#c8df20 lime-green), `--bg`, `--surface`, `--text`, `--danger`, `--success`, `--warn`.

Typography: **Syne** (display/headings) + **DM Mono** (labels, code, metadata).
