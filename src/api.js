function mergeLiffStateParams_(e) {
  const params = (e && e.parameter) ? { ...e.parameter } : {};
  const rawState = params['liff.state'];
  if (!rawState) return params;
  try {
    const search = rawState.startsWith('?') ? rawState.slice(1) : rawState;
    const [key, value] = search.split('=');
    if (key && value && !params[key]) {
      params[key] = value;
    }
  } catch (err) {
    // ignore
  }
  return params;
}

function parseIcsToEvents_(icsText) {
  if (!icsText || typeof icsText !== "string") return [];
  const rawLines = icsText.replace(/\r\n/g, "\n").split("\n");
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (/^[ \t]/.test(line) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur && cur.dtstart) { events.push(normalizeEvent_(cur)); } cur = null; continue; }
    if (!cur) continue;
    const m = line.match(/^([A-Z-]+)(;[^:]*)?:(.*)$/);
    if (!m) continue;
    const key = m[1], value = m[3];
    if (key === "DTSTART") cur.dtstart = value;
    if (key === "DTEND") cur.dtend = value;
    if (key === "SUMMARY") cur.summary = unescapeIcsText_(value);
    if (key === "LOCATION") cur.location = unescapeIcsText_(value);
    if (key === "DESCRIPTION") cur.description = unescapeIcsText_(value);
  }
  return events.sort((a, b) => (a.dtstart || "").localeCompare(b.dtstart || ""));
}

function normalizeEvent_(cur) {
  const start = parseIcsDateTime_(cur.dtstart);
  const end = parseIcsDateTime_(cur.dtend);
  const dateKey = Utilities.formatDate(start, "Asia/Tokyo", "yyyy/MM/dd");
  const startStr = Utilities.formatDate(start, "Asia/Tokyo", "yyyy/MM/dd HH:mm");
  const endStr = Utilities.formatDate(end, "Asia/Tokyo", "HH:mm");
  return { dateKey, start: startStr, end: endStr, summary: cur.summary || "", location: cur.location || "", description: cur.description || "" };
}

function parseIcsDateTime_(s) {
  const m = String(s || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/);
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), m[6] ? Number(m[6]) : 0);
}

function unescapeIcsText_(s) {
  return String(s || "").replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function logDebugToSheet_(rows) {
  if (!CONFIG.memberSheetId) return;
  try {
    const ss = SpreadsheetApp.openById(CONFIG.memberSheetId);
    const sheet = ss.getSheetByName("DebugLog") || ss.insertSheet("DebugLog");
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  } catch (err) {
    // ignore
  }
}

function loadMembersFromCsv_() {
  if (!CONFIG.memberCsvFolderId) return [];
  try {
    const folder = DriveApp.getFolderById(CONFIG.memberCsvFolderId);
    const files = folder.getFilesByType(MimeType.CSV);
    let latestFile = null;
    let latestDate = new Date(0);
    while (files.hasNext()) {
      const file = files.next();
      const modified = file.getLastUpdated();
      if (modified > latestDate) {
        latestDate = modified;
        latestFile = file;
      }
    }
    if (!latestFile) return [];
    const csvText = latestFile.getBlob().getDataAsString("utf-8");
    return parseCsvToMembers_(csvText);
  } catch (err) {
    console.error("CSV reading error:", err);
    return [];
  }
}

function parseCsvToMembers_(csvText) {
  const rows = Utilities.parseCsv(csvText);
  if (!rows || rows.length === 0) return [];

  const headerRowIndex = rows.findIndex(r => r.some(cell => String(cell || "").trim() !== ""));
  if (headerRowIndex < 0) return [];

  const headers = rows[headerRowIndex].map(h => String(h || "").trim());
  const col = buildHeaderIndex_(headers);

  const getCell = (row, idx) => (idx >= 0 ? row[idx] || "" : "");
  const members = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const userId = getCell(row, col.userId);
    if (!userId) continue;
    members.push({
      userId: String(userId),
      displayName: getCell(row, col.lineName),
      bambooName: getCell(row, col.bambooName),
      lastAccess: getCell(row, col.accessedAt)
    });
  }
  return members;
}

function recordUserAccess_(payload) {
  const userId = typeof payload === "string" ? payload : (payload && payload.userId);
  const displayName = payload && payload.displayName ? String(payload.displayName) : "";
  const bambooName = payload && payload.bambooName ? String(payload.bambooName) : "";

  if (!userId) {
    Logger.log("recordUserAccess_: userId missing");
    return "ERROR: userId missing";
  }
  if (!CONFIG.memberSheetId) {
    Logger.log("memberSheetId not configured");
    return "ERROR: memberSheetId not configured";
  }

  try {
    const sheet = SpreadsheetApp.openById(CONFIG.memberSheetId).getSheetByName(CONFIG.memberSheetName);
    if (!sheet) {
      Logger.log("Sheet not found: " + CONFIG.memberSheetName);
      return "ERROR: sheet not found";
    }

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const col = buildHeaderIndex_(headers);
    if (col.userId < 0 || col.accessedAt < 0) {
      return "ERROR: required columns not found";
    }
    const lastRow = sheet.getLastRow();
    const data = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues() : [];

    const timestamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
    let rowIndex = -1;
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][col.userId]) === String(userId)) {
        rowIndex = i;
        break;
      }
    }

    if (rowIndex >= 0) {
      const targetRow = rowIndex + 2;
      const updates = {};
      updates[col.accessedAt] = timestamp;
      if (displayName) updates[col.lineName] = displayName;
      if (bambooName) updates[col.bambooName] = bambooName;

      const rowValues = sheet.getRange(targetRow, 1, 1, headers.length).getValues()[0];
      Object.keys(updates).forEach(idx => {
        rowValues[Number(idx)] = updates[idx];
      });
      sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
      Logger.log("Access updated for userId: " + userId + " at " + timestamp);
      return "OK: access updated";
    }

    if (col.number < 0) {
      return "ERROR: number column not found";
    }
    const numberValues = data.map(r => Number(r[col.number]) || 0);
    const nextNo = (numberValues.length ? Math.max.apply(null, numberValues) : 0) + 1;
    const newRow = new Array(headers.length).fill("");
    newRow[col.number] = nextNo;
    newRow[col.accessedAt] = timestamp;
    newRow[col.userId] = String(userId);
    newRow[col.lineName] = displayName;
    newRow[col.bambooName] = bambooName;
    sheet.appendRow(newRow);
    Logger.log("Access recorded (new row) for userId: " + userId + " at " + timestamp);
    return "OK: access recorded (new row)";
  } catch (err) {
    Logger.log("Error in recordUserAccess_: " + err.toString());
    return "ERROR: " + err.toString();
  }
}

function getMembersFromSheet_() {
  const members = loadMembersFromCsv_();
  if (members.length > 0) return members;
  if (!CONFIG.memberSheetId) return [];
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.memberSheetId).getSheetByName(CONFIG.memberSheetName);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const col = buildHeaderIndex_(headers);
    if (col.userId < 0) return [];
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];
    const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    const getCell = (row, idx) => (idx >= 0 ? row[idx] || "" : "");
    return data.map(row => ({
      userId: getCell(row, col.userId),
      displayName: getCell(row, col.lineName),
      bambooName: getCell(row, col.bambooName),
      lastAccess: getCell(row, col.accessedAt),
      number: getCell(row, col.number)
    }));
  } catch (err) {
    Logger.log("getMembersFromSheet_ error: " + err);
    return [];
  }
}

function buildHeaderIndex_(headers) {
  const norm = (h) => String(h || "").trim().toLowerCase();
  const lower = headers.map(norm);
  const find = (candidates) => {
    for (let i = 0; i < lower.length; i++) {
      if (candidates.includes(lower[i])) return i;
    }
    return -1;
  };

  return {
    number: find(["no.", "no", "番号", "id"]),
    accessedAt: find(["日時", "アクセス日時", "最新アクセス日時", "lastaccess"]),
    userId: find(["user-id", "ユーザーid", "ユーザーid", "userid", "user id"]),
    lineName: find(["line名", "line", "line name", "line表示名", "システム表示名", "line名 (表示名)", "line displayname"]),
    bambooName: find(["竹号", "竹号記述回答", "竹号/備考", "竹号記入"])
  };
}
