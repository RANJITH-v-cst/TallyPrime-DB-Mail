# ANTIGRAVITY REFERENCE — TDL NOTES & PROJECT MEMORY
**Owner:** Ranjith V | Advent Systems (Certified Tally Partner, Coimbatore)  
**Compiled & Updated:** 12 Nov 2026  

---

## HOW TO USE THIS FILE
- **Section A:** Profile & working preferences
- **Section B:** TDL fundamentals (language rules, syntax, confirmed facts)
- **Section C:** TDL efficiency / performance notes
- **Section D:** Client / project notes (TDL customizations)
- **Section E:** Integration & middleware projects (Electron / Flask / Node / Python)
- **Section F:** Misc / recent work

All items below are things confirmed or stated by Ranjith during earlier work.
Where something is marked "unresolved" or "unverified", treat it as not yet proven.

---

## SECTION A — PROFILE & PREFERENCES
- **Name:** Ranjith V
- **Works at:** Advent Systems, a certified Tally partner based in Coimbatore, Tamil Nadu.
- **Work centers on:** TallyPrime TDL (Tally Definition Language) customization and full-stack integration development.
- **Clients:** Afternoon (print media / advertising publication), Advent Electronics, Sudhan Publicity, Gorlan India Switch Gears, Pipe Solutions, BVC Logistics, ChirixERP.
- **Communication & Coding Preferences:**
  - Responses in English only.
  - Complete, ready-to-run, corrected TDL and code blocks given inline.
  - Works iteratively with screenshots for field-name verification.
  - Uses Developer Mode (`Ctrl+Alt+B`) in TallyPrime for field/line/part name verification.
  - Interest in cybersecurity awareness education (side project: OTP Scam Awareness Simulator).

---

## SECTION B — TDL FUNDAMENTALS (CONFIRMED RULES)

### B1. Symbols & Prefixes
- `$` = Field / UDF / Method value on the object in context (e.g. `$LedgerName`, `$ClosingBalance`).
- `$$` = Built-in system function call (e.g. `$$DateOf`, `$$StringLength`, `$$CollectionField`).
- `##` = System / Global variable value (e.g. `##SVCurrentCompany`, `##SVFromDate`, `##SVCurrentDate`).
- `@@` = Global / System formula reference (must be defined inside `[System: Formula]`).
- `@` = Local formula reference (scoped locally inside Part/Line/Field).
- `#` = Field reference, or definition modifier prefix (e.g. `[#Form: Default]`, `[#Line: EI ColumnOne]`).
- `!` / `*` = Definition modifier prefixes (`[!Line: ...]`, `[*Part: ...]`) used to safely alter an existing definition in context.
- `[System: Formula]` has no inherent object context; context must be passed via functions like `$$ReqObject` or explicit object method prefixes.

### B2. Structure & Language Rules
- **Strict Hierarchy:** `Report` → `Form` → `Part` → `Line` → `Field`. Never attach a `Field` directly to a `Part`; it must always go through a `Line`.
- **Flat Definitions:** All `[Part]`, `[Line]`, `[Field]` definitions must be flat at root level — no nesting.
- **Multi-Word Space Literals:** Multi-word Field/Definition names are space-literal. Field `"VCHBILL Date11"` must be referenced as `#VCHBILL Date11` everywhere, including inside formulas. Dropping the space silently targets a non-existent field.
- **Compute Method Space Stripping:** Methods defined via `Compute: Owner Company : $$LoopCollObj:$Name` are space-stripped upon retrieval and referenced as `$OwnerCompany` (single `$`, no space).
- **Aggregation Arguments:** `$$Total:<FieldName>` strips spaces from its argument (e.g. `$$Total:VCHGSTInvPrintTaxValue`).
- **Disappearing Column Traps:** `Local: Field: ... Set as: ""` silently blanks UDF values. Use `Invisible: Yes` or conditional visibility instead.
- **Numeric Formatting:** `$$AsAmount:0` formats rather than suppresses — use `""` to blank a field.
- **Control Flow:** `Else If` is invalid in `[Function]` blocks — use nested `IF ... ELSE ... END IF`.
- **Menu Scope:** `Inactive` does not work at the Gateway of Tally menu level.
- **Wildcard Reports:** `[#Report: *]` wildcard is invalid — use `[#Form: Default]` with an `On: Print` event hook.

### B3. Collection Functions & Behavior
- **`$$CollectionField` parameter order:**
  ```tdl
  $$CollectionField:<ValueExpression>:<PositionNumber>:<CollectionName>
  ```
- **`$$CollectionFieldByKey` parameter order (Confirmed Working):**
  ```tdl
  $$CollectionFieldByKey:<ValueExpr>:<CollectionName>:<Position>:<KeyFormula>
  ```
  *(Same signature shape as `$$FilterValue`; significantly faster than iterative filters for large datasets).*
- **Collection Functions at Menu Level:** `$$CollectionField`, `$$FilterCount`, and `$$CollectionFieldByKey` do **not** work at Menu level — Report/Collection context only.
- **Deduplication:** `Unique: $HSN` or `Unique: $LedgerName` confirmed as a working Collection attribute for deduping rows by a field value.
- **Grouping:** `By:` in a Collection only creates a per-object formula field; it does **not** group rows. An `Aggr Compute` with `By:vchnum:$hsn` still sums over the whole voucher.

### B4. Conditional Constructs
- `Switch` stops at the first matching condition per label (faster); `Option` evaluates all conditions every time. Prefer `Switch` for mutually exclusive branches.
- `Do If : <Condition> : <ActionKeyword> [:<Params>]` (Tally.ERP 9 Release 6+ & TallyPrime) replaces older ActionEx patterns.
- Direct string comparisons are preferred over `##SVPurchase` / `##SVSales` variables in filter formulas.

### B5. Modern Dotted-Path Context Walking
- Syntax: `$(<ObjectType>, <IdentifierFormula>).<SubCollection>[<Index>, <Condition>].MethodName`
- Relative Scope: `.` = current, `..` = parent, `...` = grandparent.

### B6. Useful Functions & Hierarchy Fetch
- `$$GroupSundryDebtors` / `$$GroupSundryCreditors`: Returns actual (possibly localized/renamed) group name.
- `$$CmpUserName`: Correct function for company user detection (not `$$UserName`).
- `$$ReqObject:$PartyLedgerName`: Bridges voucher party context into collection filter.
- `$$SysInfo:<Parameter>`: `ApplicationPath`, `CurrentPath`, `SystemDate`, `SystemTime`, `SystemTimeHMS`, `SystemName`, `IsWindows`, `WindowsVersion`, `WindowsUser`, `IPAddress`, `MACAddress`.
- **Hierarchy HSN Fetch (Confirmed Working in Sales Register):**
  ```tdl
  Compute : PQRHSNCode : $$GetInfoFromHierarchy:$StockItemName:"Stock Item":"HSNCode":$Date:"GST"
  ```
  Resolves HSN through item → group → company hierarchy using voucher date.
- **Direct Item HSN Fetch:** `$HSNCode:StockItem:$StockItemName`.
- **Company GSTIN:** `$GSTRegistrationNumber:Company:##SVCurrentCompany`.
- **Bank Ledger Details:** `$BankAccHolderName`, `$BankDetails` (Account Number), `$IFSCode`, `$PaymentDetails.BankBranchName` (fetch Child Of `$$SysName:BankAccounts`).
- **Voucher Inventory Fetch:** `AllInventoryEntries.TrackingNumber`, `AllInventoryEntries.TrackingDate`.
- **GSTR3B Fetch:** `AllInventoryEntries.GSTItemHSNCodeEx`, `.GSTLedItemIGSTRateEx`, `.GSTEntryStockItemName`, `.GSTEntryLedgerName`.

### B7. Events, Timers, Refresh
- **Timer Event Syntax:**
  ```tdl
  [System : Event] <Timer Name> : TIMER : <Condition> : <Action> : <Action Parameters>
  START TIMER : <Timer Name> : <Duration>   ; Duration in SECONDS (3600 = 1 hour)
  STOP TIMER : <Timer Name>
  ```
- **System Events:** `Load Company`, `Close Company`, `System Start`, `System End`.
- Officially documented refresh action is `Refresh Data` (no report-name parameter) — refreshes current active report.

### B8. UDF & Storage Rules
- `"Incorrect TYPE for Field! Conflicts with STORAGE!"`: Storage type is locked by first usage. Fix: declare `Type: Date` directly, not `Use: Date Field`.
- Never reuse a UDF index for different fields across the codebase.
- Reusing the same `Option:` name as an `Add:Option` gate on two base lines while writing only one `[!Line:<name>]` body causes anchor mismatches. Use unique option names per site.

### B9. Digital Signature
- Pure TDL only renders a scanned signature/stamp image (`Type: Bitmap`). True PKI/DSC signing requires external automation.

### B10. Multilingual / Tamil Fixed Text
- Write TDL in TallyPrime Developer, insert Tamil text in relevant fields, save as text, reopen in Notepad, add multilingual text with Windows Unicode fonts, save with UTF-8/Unicode encoding, configure `.txt` to TallyPrime.

### B11. HTTP & XML Gateway Integration Facts (Single-Threaded Port 9000)
1. **Always HTTP 200 on Errors:** TallyPrime's HTTP gateway returns HTTP 200 even when errors occur. Always inspect payload for `<LINEERROR>`, `<STATUS>0</STATUS>`, or missing expected tags.
2. **Typed Attribute Wrapping:** Tally XML exports wrap primitives in metadata type attributes (`<DATE TYPE="Date">20261112</DATE>`, `<AMOUNT TYPE="Amount">5000.00</AMOUNT>`). Fast XML parsers wrap these in `{ '#text': value, '@_TYPE': '...' }`. Unwrapping `#text` is mandatory to avoid `[object Object]` and `NaN`/`0.00` calculation bugs.
3. **Multi-Voucher Message Wrapping:** Vouchers in native Day Book XML exports are wrapped in individual `<TALLYMESSAGE>` nodes under `<REQUESTDATA>`. XML parsers must recursively traverse all messages.
4. **Standard Day Book Request vs Custom Collections:**
   - Overriding default reports (`[Part: DB Body]`) over HTTP causes TDL crash popups (`No PARTS or LINES or BUTTONS`).
   - Querying standard Day Book over HTTP requires:
     ```xml
     <ENVELOPE>
      <HEADER>
       <VERSION>1</VERSION>
       <TALLYREQUEST>Export</TALLYREQUEST>
       <TYPE>Data</TYPE>
       <ID>Day Book</ID>
      </HEADER>
      <BODY>
       <DESC>
        <STATICVARIABLES>
         <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
         <SVCURRENTCOMPANY>Company Name</SVCURRENTCOMPANY>
         <SVFROMDATE TYPE="Date">YYYYMMDD</SVFROMDATE>
         <SVTODATE TYPE="Date">YYYYMMDD</SVTODATE>
         <EXPLODEFLAG>Yes</EXPLODEFLAG>
        </STATICVARIABLES>
       </DESC>
      </BODY>
     </ENVELOPE>
     ```
5. **Ledger List Tag Variations:**
   - Standard accounting vouchers (Payment, Receipt, Contra, Journal) store ledgers in `<ALLLEDGERENTRIES.LIST>`.
   - Invoices (Sales, Purchase, Debit Note, Credit Note) store party and tax ledgers in `<LEDGERENTRIES.LIST>`, while item revenue accounts reside in `<ALLINVENTORYENTRIES.LIST><ACCOUNTINGALLOCATIONS.LIST>`.
6. **Day Book Accounting Display:**
   - In Tally Day Book: Payment vouchers display the debited party in the **Debit Amount** column; Sales invoices display the debited customer in the **Debit Amount** column. The grand total equals the sum of voucher debits.
7. **Isolated Discovery Collections:** Avoid calling unformatted reports like `List of Companies`. Use custom-prefixed collections:
   ```xml
   <COLLECTION NAME="ADV Company Coll" ISMODIFY="No" ISFIXED="No">
     <TYPE>Company</TYPE>
     <FETCH>Name</FETCH>
   </COLLECTION>
   ```

---

## SECTION C — TDL EFFICIENCY & PERFORMANCE NOTES
- **Batch Posting:** Wrap bulk imports in `START BATCH POST` / `END BATCH POST` to reduce lock/unlock database overhead.
- **`Keep Source` Caching:** Caches source collections in memory at the report or owner level so secondary summary collections do not rebuild from disk repeatedly.
- **Optimal Method Fetches:** Fetch only explicitly needed methods (`<FETCH>DATE, VOUCHERNUMBER, ...</FETCH>`). Avoid wildcard `*.*`.
- **`Set By Condition` vs `Set as (IF-THEN-ELSE)`:** `Set By Condition` halts at the first matching branch, reducing formula evaluation time.
- **Memory Key Indexing:** For reports with non-repeated secondary collections, use summary collections with `$$CollectionFieldByKey` rather than repetitive platform searches.

---

## SECTION D — CLIENT & PROJECT TDL NOTES

### D1. Afternoon — Advertisement Invoice TDL
- **Terms & Conditions (`[Part: AftnInvFooter]`):** Split long points (5, 6, 8, 9) into `a/b` sub-fields due to ~140-char mid-word wrap limit at 190mm / 8pt Arial Bold. Standardized to `Width: 190 mms`.
- **Dispatch From:** UDF `DispatchFrom` (Storage: 3001, String) stores ledger name. Repeat address via `Repeat : DisParADD : Address : Ledger : $DispatchFrom`. Persistent variable `SVCurDispatchFrom` bridges voucher to ledger context.
- **Accounting Invoice Custom Columns:** Uses `EI AccInfo` data rows (not `EI InvInfo`). Right Fields added before `EI Value`. Header titles before `VCH AmtTitle` in `EI ColumnOne`.

### D2. Sudhan Publicity — Invoice TDL & Pirpagal Variant
- **Form:** `Sales Color`; print format `SUDHAN` (Letter 210×305mm, space top 38mm).
- **Pirpagal Variant:** `##SvCurrentCompany="Pirpagal"` and `##VoucherTypeName="GST Sales New"`. Pulls `$RODATEVALUE11` from linked Order voucher via `$OrderNumber`. GSTIN: `33AAYFP7213N1ZK`.
- **Bill Allocation:** Line `DSPVCHBILAllocExplosion`, `#Line: VCHBILL ExplLine`. Field `#VCHBILL Date11` sourced from `BillCol` and resolved via `$$CollectionFieldByKey`. Due Days: `$$GetDuration:#VCHBILL Date11:$Date`.
- **WhatsApp Share Button:** Exports PDF via `$$MakeExportName` and invokes `web.whatsapp.com` using `@@mobileno` and `@@Linemsg`.

### D3. Advent Electronics — WhatsApp + PDF Export
- PDF export followed by `api.whatsapp.com/send` URL dispatch.
- Filename sanitization: Strip `/` from `$$MachineDate` and `$VoucherNumber`.
- Session variable reset required after `EXPORT REPORT` to prevent stale print data on consecutive runs.

### D4. Pipe Solutions — Invoice Customization
- **Feature Gates:** Combined company-level UDF `Enable_PIPESolutions` (23) and voucher-type UDF `HVEnable_PIPESolutions` (22).
- **Alt-Unit UDFs:** `VCH_Qty` (12003), `VCH_Rate` (12004), `VCH Per1` (12005), `VCH Per2` (12006). Printed via `Format: "No Zero,Decimal:3"`.
- **Voucher-Total Qty-in-Kgs:** Aggregated via `AllInventoryEntries` walking, displayed via `$$Sprintf`.
- **Multi-Address Company Printing:** UDF `InvoAdd` (3520) stores per-voucher company address type. Looked up via `TestLedColSum` and rendered via `$$FullList:TestLedColSum:$Address`.

### D5–D11. Special Modules Summary
- **D5. GST Analysis (VCHGSTQty):** Standard GST rate inference via `vGetGSTItemDetails` and `xGSTRateInferenceDetails`.
- **D6. POS Register:** Logo sub-part (35mm) + text column (159mm) = 194mm. Inactivation of all delete/cancel keys for non-admin users. POS columnar payment fields must retain Tally's internal fetch logic (override only `Width`).
- **D8. Fixed Asset Register (FAR):** Assertion Number format `AST-YYYY-XXXX` as Voucher UDF. `Skip: Yes` with conditional `Set as` freezes number on generation.
- **D9. Print History Log:** Gateway-accessible log hooked on `[#Form: Default]` `On: Print`. Deletion supported via `Delete Collection Object : PH_Log_Agg : 1 : @@PH_IsSelEntry` inside Company edit mode.
- **D10. Barcode Label Printing:** Two-column 55mm layout; Code 39 with `IDAutomationHC39M Free Version` font. Spaces replaced with `=` and bounded by `( )`. Font preview only visible on physical/PDF print, not screen preview.
- **D12. T-Format Trial Balance (Confirmed Working 2026-10-17):** Report `Trial Balance TFormat` (Credit LEFT, Debit RIGHT). Uses `GRP Explosion : @@IsExplodableGroup AND ($$KeyExplode OR ##ExplodeFlag)` without `$IsSubLedger` filter.

---

## SECTION E — INTEGRATION & MIDDLEWARE PROJECTS

### E1. ChirixERP → TallyPrime Sales Voucher Import
- API-driven sales voucher ingestion into Tally.
- Architecture: Pure TDL integration inside TallyPrime utilizing Tally's `Data Source: HTTP JSON` and `Export Header` (sending Chirix API key), walking the returned JSON collection and instantiating vouchers directly via `New Object: Voucher`.

### E2. BVC Logistics (BVC Universe API)
- Automated dispatch of Tally sales invoices to BVC Logistics (`api.bvcuniverse.com`).
- Sequence: Create Shipping Account → Create Shipping Address → Create Shipment → Track Shipment.

### E3. TallyDayBookMailer Middleware (Multi-Company Automated Export)
- **Repository:** `github.com/RANJITH-v-cst/TallyPrime-DB-Mail`
- **Stack:** Node.js, TypeScript, Express, ExcelJS, fast-xml-parser, node-cron, Nodemailer with AES-256-GCM encryption at rest.
- **Architecture & Workflow:**
  1. **Tally Connection & Discovery:** Connects to `127.0.0.1:9000`. Discovers open company tabs via isolated `ADV Company Coll`.
  2. **Day Book Extraction & Multi-Day Date Ranges:**
     - For single-day exports (`today`), queries native Day Book XML using `<TYPE>Data</TYPE><ID>Day Book</ID>` with `<EXPLODEFLAG>Yes</EXPLODEFLAG>` and `<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>`.
     - **Multi-day / Custom Period Fallback:** Tally's headless HTTP gateway does not retain interactive UI date ranges across multi-day views when queried via `<ID>Day Book</ID>`. When querying date ranges (e.g. `20260401` to `20260430` with 1,200+ vouchers), the engine queries via dynamic TDL Collection `ADV DayBook Coll` with `<FILTER>$Date >= ##SVFromDate AND $Date <= ##SVToDate</FILTER>`, fetching all vouchers and ledger allocations in a single high-performance roundtrip.
     - **Caution on CMPINFO:** Tally returns `<CMPINFO><VOUCHER>0</VOUCHER></CMPINFO>` in master export envelopes even when vouchers exist; never use `.includes('<VOUCHER')` to test for voucher presence. Always evaluate parsed `vouchers.length === 0`.
  3. **Robust XML Parsing:** Uses `extractText()` and `extractNumber()` unwrappers to extract `#text` values from typed XML tags (`TYPE="String"`, `TYPE="Date"`, `TYPE="Amount"`), eliminating `[object Object]` and `0.00` calculation bugs. Inspects `ALLLEDGERENTRIES.LIST`, `LEDGERENTRIES.LIST`, and `ALLINVENTORYENTRIES.LIST.ACCOUNTINGALLOCATIONS.LIST`.
  4. **Excel Rebuild:** Uses `exceljs` to generate a Day Book layout matching TallyPrime:
     - Company Name, "Day Book", Period header (`01-Apr-26 to 30-Apr-26` or single date).
     - Main voucher line shows party name and voucher amount in the **Debit Amount** column for Payments and Sales (matching TallyPrime's Day Book screen).
     - Detailed mode indents individual ledger allocations (DR/CR) and narration.
     - Grand total row balances correctly without double-counting.
     - Empty dates output `"No transactions recorded for this date"` with `0.00` totals (no ghost rows).
  5. **Common Folder Storage:** Saves files atomically (`.tmp` + rename) to `<User Profile>\Desktop\Advent DB Export` with collision avoidance (`_1.xlsx`, `_2.xlsx`) and retention pruning.
  6. **Scheduling, Manual Runs & CLI:**
     - **Daily Nightly Mode:** Configured via `node-cron` (`0 20 * * *`) to automatically export and email the current date's transactions every night at **8:00 PM (20:00)**.
     - **Custom Date Range CLI:** Run `node scripts/directExport.js [YYYYMMDD] [YYYYMMDD]` (e.g. `node scripts/directExport.js 20260401 20260430`) for instant manual exports and mailing of any date range.
     - **Control Center:** Web UI at `http://127.0.0.1:9095` featuring recipient chip inputs, regex validation, atomic settings persistence, Test Tally, Test Mail, and manual "Send Now" triggers.

### E4. Gorland Reports
- Electron + React + TypeScript desktop middleware integrating with TallyPrime HTTP/XML on port 9000.
- Implements SQLite caching, chunked date-range fetching, and parsing of `<LINEERROR>` and `<STATUS>0</STATUS>`.

---

## SECTION F — RECENT WORK & REFERENCE LOG
- **TallyPrime 7.1 Beta Documentation:** Compiled 10 feature guides for Advent Systems (Tally IRA, Print Templates, Connected Banking, IMS Party Reconciliation, HSN Validation, Auto Wrap Text, Schedule III Reports).
- **OTP Scam Awareness Simulator:** Standalone educational cybersecurity prototype.

---
*Reference file verified and aligned with Advent Systems codebase standards.*

