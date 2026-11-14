# TallyDayBookMailer (Windows Desktop Application)

**TallyDayBookMailer** is an automated Windows desktop application for TallyPrime multi-company environments. It connects directly to TallyPrime's HTTP gateway (port 9000), monitors all open company tabs, automatically exports Day Books in Excel format, and emails them on schedule or on demand.

---

## 🌟 Key Features

- **Windows Desktop Application**: Runs natively with a System Tray icon and clean desktop interface. Minimizing or closing the window keeps the application quietly running in your Windows system tray.
- **Single Instance & Auto-Start**: Supports "Start with Windows" via the tray menu. If launched with `--hidden`, it stays quietly minimized in the tray.
- **Dynamic Sender Email & App Password Configuration**: Easily configure your Google/SMTP sender email and 16-character App Password directly in the UI. Features one-click **"Auto-fill Gmail"**, password visibility toggling (`👁️ Show`), and an in-place **"Test SMTP & App Password"** tool.
- **Created By & Created Time Column Sequence**: Day Book exports precisely match the TallyPrime Day Book screen layout:
  `Date | Particulars | Created By | Created Time | Vch Type | Vch No. | Debit Amount | Credit Amount`
- **Dynamic Port Selection**: Default Web UI runs on `127.0.0.1:9095`. If the port is occupied, the application automatically finds an available free local port and shows the active port in the tray tooltip.
- **Robust Multi-Company Discovery**: Detects all open company tabs (`"companies": "auto"`) and processes each company sequentially without freezing Tally.
- **Dual Exporter with Intelligent Fallback**:
  1. **NativeExcelExporter**: Retrieves Tally's native Day Book Excel export directly. Verifies that `Created By` and `Created Time` columns are present.
  2. **XmlRebuildExporter**: Rebuilds the exact Day Book workbook from Tally's Voucher Collection if Tally native export times out or lacks the UDF columns.
- **AES-256 Encryption at Rest**: Passwords and secrets are encrypted with machine-derived AES-256 keys.

---

## 📦 Installation & Setup

### 1. Download & Install
1. Run the installer: `release\Tally DayBook Mailer Setup 1.0.0.exe` (or build with `npm run electron:build`).
2. The installer installs per-user (no Administrator rights required) and creates Desktop and Start Menu shortcuts.
3. The app opens at `http://127.0.0.1:9095`.

### 2. Runtime Data Location
All persistent files are stored in the user data directory:
`%APPDATA%\tally-daybook-mailer` (e.g. `C:\Users\<User>\AppData\Roaming\tally-daybook-mailer`)
- `config.json` — Application configuration
- `.key` — Encryption secret
- `state.json` — Last cycle status and ALTERID trackers
- `logs/` — Winston rotating daily application logs
- `debug/` — Raw Tally request/response dumps when `DEBUG_TALLY_REQUEST=true`

---

## 📧 How to Set Sender Mail ID & App Password in the UI

1. Launch **Tally DayBook Mailer**.
2. Go to the **Settings** tab (or click **"⚙️ Set Sender Mail / App Password"** on the Dashboard).
3. Under **Sender Account & App Password**:
   - **Sender Mail ID**: Enter your email (e.g. `yourbusiness@gmail.com`).
   - Click **"⚡ Auto-fill Gmail Settings"** to set the host (`smtp.gmail.com`) and port (`465 SSL`).
   - **App Password**: Enter your 16-character Google App Password. Click **"👁️ Show"** to verify what you typed.
   - Click **"🧪 Test SMTP & App Password"** to immediately verify your email credentials.
4. Click **"Save Settings"** at the bottom of the page.

### Generating a Gmail App Password
1. Visit [Google Account Security](https://myaccount.google.com/security) and ensure **2-Step Verification** is **ON**.
2. Navigate to [Google App Passwords](https://myaccount.google.com/apppasswords).
3. Enter an app name like **TallyMailer** and click **Create**.
4. Copy the 16-letter password (e.g., `abcd efgh ijkl mnop`) and paste it into the UI. Spaces are automatically handled.

---

## 🖥️ System Tray Features

When you close the main application window, the application **does not exit**; it minimizes to the system notification area (tray).

- **Double-Click Tray Icon**: Shows or hides the application window.
- **Right-Click Tray Menu**:
  - **Open Tally DayBook Mailer**: Opens and focuses the dashboard window.
  - **▶ Send Now**: Immediately triggers a Day Book export cycle for all open companies.
  - **Start with Windows**: Toggle automatic startup on Windows login.
  - **Open Exports Folder**: Opens the exported Excel files folder.
  - **Open Logs Folder**: Opens the folder containing daily logs.
  - **Quit**: Gracefully shuts down background services and exits the app.

---

## 🛠️ Development & Building

```bash
# Install dependencies
npm install

# Run unit tests (plain Node.js)
npm test

# Run app in dev mode (Electron)
npm run electron:dev

# Build distributable Windows NSIS installer
npm run electron:build
```

---

## 📜 Differences from Legacy Service

- **Old version**: Ran as a hidden background Windows Service (`node-windows`), requiring administrator permissions and manual browser navigation to `127.0.0.1:9095`. Service scripts have been archived in `legacy/`.
- **New version**: Modern Windows Desktop application with System Tray integration, single-instance control, automatic port conflict handling, and native notifications.
