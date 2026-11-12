# TallyDayBookMailer

**TallyDayBookMailer** is a production-grade Windows middleware application designed for TallyPrime multi-company environments. It automatically connects to TallyPrime's HTTP server, monitors multiple simultaneously open company tabs (e.g. 5 open tabs), exports their Day Books in Excel format every 30 minutes, and emails them to configured recipients with automatic retry, concurrency locking, and fallbacks.

---

## 🌟 Key Features

- **Multi-Company Concurrency**: Discovers all open company tabs dynamically (`"companies": "auto"`) or validates a configured list. Exports each company sequentially using `SVCURRENTCOMPANY` without relying on which tab is active.
- **Dual Exporter with Intelligent Fallback**:
  1. **NativeExcelExporter**: Fetches Tally's official Excel export (`$$SysName:Excel`, `XLSX`, `Spreadsheet`) and verifies the binary PK zip magic header.
  2. **XmlRebuildExporter**: If Tally returns non-PK bytes or an error, it queries the Day Book Voucher Collection via TDL XML and rebuilds an identical `.xlsx` file using `exceljs`, featuring Indian numbering format (`#,##,##0.00`), formatted dates (`dd-MMM-yy`), voucher-wise indented ledger lines in detailed mode, and matching grand totals.
- **Since-Last-Run Incremental Mode**: Tracks the maximum `ALTERID` per company in an atomic `state.json` file. Only emails new or modified vouchers in subsequent runs, with midnight rollover detection.
- **Non-Overlapping Scheduler**: Uses strict concurrency locking and safe timers. Never runs concurrent cycles even if an export takes longer than the interval. Includes configurable active time windows (e.g., `09:00 - 20:00`).
- **Resilient Emailing**: Nodemailer with 3x exponential backoff retries. Supports `separate` `.xlsx` attachments or a single compressed `.zip` archive. Throttles "Tally Down" alerts to at most once per hour.
- **Local Control Center (Web UI)**: Clean Express dashboard bound strictly to `127.0.0.1:9095`. Allows live status monitoring, configuration editing, log streaming, "Send Now", and "Test Mail".
- **Windows Service Ready**: Includes `node-windows` scripts for auto-start at Windows boot and automatic restart on unexpected failures.
- **Security & Privacy**: SMTP passwords are encrypted at rest with AES-256-GCM using machine-derived keys. Passwords are automatically masked in logs and web interfaces.

---

## 📁 Project Structure

```text
TallyDayBookMailer/
├── dist/                          # Compiled JavaScript production build
├── logs/                          # Daily rotating logs (30-day retention)
├── exports/                       # Saved local Excel copies (configurable retention)
├── service/
│   ├── install-service.js         # Windows Service installer script
│   └── uninstall-service.js       # Windows Service uninstaller script
├── src/
│   ├── index.ts                   # Main application entry point & lifecycle
│   ├── config/
│   │   ├── config.ts              # Configuration loader, validator, crypto at rest
│   │   └── types.ts               # Strict TypeScript interfaces
│   ├── tally/
│   │   ├── client.ts              # Axios client with 60s per-company timeout
│   │   ├── companyDiscovery.ts    # XML parser for List of Companies
│   │   ├── exporterFactory.ts     # Exporter fallback coordinator
│   │   └── exporters/
│   │       ├── types.ts           # Exporter interface
│   │       ├── nativeExporter.ts  # Tally native Excel export & PK validator
│   │       └── xmlRebuildExporter.ts # TDL XML fetch & ExcelJS rebuild
│   ├── scheduler/
│   │   ├── scheduler.ts           # Overlap prevention, interval runner, active window
│   │   ├── orchestrator.ts        # Sequential company export coordinator
│   │   └── stateManager.ts        # Atomic state.json persistence & ALTERID tracker
│   ├── mailer/
│   │   ├── mailer.ts              # Nodemailer dispatcher with 3x retry
│   │   └── templates.ts           # Dynamic subject & HTML summary table
│   ├── ui/
│   │   ├── server.ts              # Localhost Express server (127.0.0.1:9095)
│   │   └── public/
│   │       └── index.html         # Responsive web management dashboard
│   ├── utils/
│   │   ├── crypto.ts              # AES-256-GCM password encryption at rest
│   │   ├── logger.ts              # Winston daily rotating file logger
│   │   ├── sanitizer.ts           # Windows filename sanitizer
│   │   └── zip.ts                 # Archiver compression utility
│   └── mock/
│       └── mockTallyServer.ts     # Mock TallyPrime HTTP server for testing
├── test/
│   ├── sanitizer.test.ts          # Unit tests for filename sanitizer
│   ├── schedulerLock.test.ts      # Unit tests for overlap lock & active window
│   ├── stateManager.test.ts       # Unit tests for since-last-run & alert throttler
│   ├── mailBuilder.test.ts        # Unit tests for email templates
│   └── e2eMockTest.ts             # Complete End-to-End mock server test
├── config.json                    # Active configuration file
├── config.sample.json             # Annotated sample configuration
├── package.json
├── tsconfig.json
└── README.md
```

---

## ⚙️ Enabling TallyPrime's HTTP Server

TallyPrime must have its internal HTTP/ODBC server enabled on port 9000:

1. Open **TallyPrime**.
2. Press **F1** (Help) from the top menu, then select **Settings** > **Connectivity**.
3. Under **Client/Server configuration**:
   - Set **TallyPrime act as**: `Both` (or `Server`).
   - Set **Enable ODBC**: `Yes`.
   - Set **Port**: `9000` (default).
4. Save the screen and restart TallyPrime when prompted.
5. Open your 5 company tabs in TallyPrime.
6. Verify in your browser: navigate to `http://127.0.0.1:9000`. You should see an XML response or Tally server header.

---

## 📧 Email / SMTP Setup Guide

### 1. Gmail Setup (Recommended: App Passwords)
Google requires an **App Password** instead of your standard Gmail password:
1. Log in to your Google Account and visit [Google Account Security](https://myaccount.google.com/security).
2. Ensure **2-Step Verification** is turned ON.
3. In the search box at the top, type **App Passwords**.
4. Create a new app name (e.g. `TallyDayBookMailer`).
5. Copy the generated 16-character password (e.g. `abcd efgh ijkl mnop`).
6. In `config.json` (or the Web UI):
   - `smtp.host`: `smtp.gmail.com`
   - `smtp.port`: `587`
   - `smtp.secure`: `false`
   - `smtp.user`: `your-email@gmail.com`
   - `smtp.password`: `abcdefghijklmnop` (spaces removed)

### 2. Microsoft Office 365 Setup
1. `smtp.host`: `smtp.office365.com`
2. `smtp.port`: `587`
3. `smtp.secure`: `false`
4. `smtp.user`: `your-email@yourdomain.com`
5. `smtp.password`: Your Microsoft App Password.
6. Ensure SMTP AUTH is enabled for the mailbox in the Microsoft 365 Admin Center.

---

## 🚀 Quick Start & Installation

### Prerequisites
- Node.js (v18.x, v20.x, or v22.x LTS)
- Windows 10/11 or Windows Server 2016/2019/2022

### 1. Install Dependencies & Build
```powershell
npm install
npm run build
```

### 2. Run the Mock Server Integration Test
To verify the entire pipeline (company discovery, native Excel, fallback XML rebuild, ALTERID deltas, and email formatting) without live Tally:
```powershell
npx ts-node test/e2eMockTest.ts
```

### 3. Run Unit Tests
```powershell
npm test
```

### 4. Start the Application
```powershell
npm start
```
The application will:
- Open the local Web UI at **http://127.0.0.1:9095**.
- Run an initial Day Book export cycle immediately.
- Schedule subsequent cycles every 30 minutes.

---

## 🖥️ Running as a Windows Service

To ensure the application runs continuously in the background, starts automatically on Windows boot, and restarts automatically if it crashes:

### Install Service
Open PowerShell as **Administrator**:
```powershell
npm run service:install
```
*Note: A Windows UAC prompt will appear asking to authorize the service registration.*

### Uninstall Service
```powershell
npm run service:uninstall
```

### Managing via Windows Service Manager
- Press `Win + R`, type `services.msc`, and press Enter.
- Locate **TallyDayBookMailer** in the list.
- You can Start, Stop, or Restart the service directly from the Windows Services console.

---

## 🎛️ Local Web UI (Control Center)

Access **http://127.0.0.1:9095** from the machine hosting the service:

- **Dashboard**: Real-time engine status (IDLE / RUNNING), last cycle timestamp, next run countdown, and per-company summary table with voucher counts and status badges.
- **Actions**:
  - **Send Now**: Triggers an immediate export cycle.
  - **Test Tally**: Pings TallyPrime and displays all open company tabs.
  - **Test Mail**: Verifies SMTP connection and authentication credentials.
- **Settings Editor**: Modify schedule interval, voucher filters, period mode, recipients, and SMTP credentials with instant saving.
- **Live Logs**: Real-time viewing of the last 100 log entries from the active daily log file.

---

## 🔧 Troubleshooting Guide

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| `ECONNREFUSED 127.0.0.1:9000` | TallyPrime is closed or HTTP server is disabled. | Open TallyPrime. Press `F1 > Settings > Connectivity`, enable ODBC/Server, set port to 9000, and restart TallyPrime. |
| `Configured company is not loaded` | Company is not open in one of TallyPrime's tabs. | Open the required company tab in TallyPrime, or set `"companies": "auto"` to automatically discover open tabs. |
| `Invalid Login / Username and Password not accepted` | Incorrect SMTP password or missing App Password. | For Gmail / Office365, generate an App Password in your account security settings. |
| Native Excel returns non-PK response | TallyPrime version does not support native binary XLSX streaming over HTTP. | The app automatically activates `XmlRebuildExporter`, which rebuilds the `.xlsx` identically via ExcelJS. |
| `An export cycle is already in progress` | Previous cycle took longer than the interval. | The built-in lock safely skips the duplicate run to prevent TallyPrime congestion. It will run on the next interval. |

