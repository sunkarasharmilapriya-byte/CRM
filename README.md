# Northstar CRM

A self-hosted customer relationship workspace with a responsive web app, an authenticated JSON API, and a local SQLite database. It includes an overview dashboard, contacts, companies, leads, a deal pipeline, tasks, activity history, and summary reports.

## Requirements

- Node.js 22.5 or newer (uses Node's built-in `node:sqlite`; no packages to install)

## Run locally

```sh
npm start
```

In Windows PowerShell, run `npm.cmd start` if script execution policy blocks `npm`.

Open [http://localhost:3000](http://localhost:3000), then create an account. The first account and any later accounts have separate, private CRM records.

Set `PORT` to change the listening port or `CRM_DB_PATH` to choose a different SQLite database file. For example, in PowerShell:

```powershell
$env:PORT = "3001"
$env:CRM_DB_PATH = "C:\data\northstar.sqlite"
npm.cmd start
```

## Included

- Account registration and sign-in with scrypt-hashed passwords and expiring, HTTP-only sessions
- Private, account-scoped records with create, edit, delete, and search for contacts, companies, leads, deals, tasks, and activities
- Sales pipeline board, dashboard metrics, task follow-ups, and summary reports
- SQLite storage in `crm.sqlite` by default; the database is created automatically

This is a self-hosted starter CRM. Before exposing it to the public internet, deploy behind HTTPS and add operational controls such as backups, email verification, rate limiting, and a managed secret/configuration process.
