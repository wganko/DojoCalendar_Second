/**
 * Main entry point
 */
function doGet(e) {
  const mergedParams = mergeLiffStateParams_(e);
  const groupKey = mergedParams.g || CONFIG.defaultGroup;
  const group = CONFIG.groups[groupKey] || CONFIG.groups[CONFIG.defaultGroup];
  const userId = mergedParams.userId || "";

  const events = parseIcsToEvents_(group.ics);

  const tmpl = HtmlService.createTemplateFromFile("index");
  tmpl.eventsJson = JSON.stringify(events);
  tmpl.groupLabel = group.label;
  tmpl.configJson = JSON.stringify({
    liffId: CONFIG.liffId,
    userId: userId,
    memberSheetId: CONFIG.memberSheetId,
    memberSheetName: CONFIG.memberSheetName
  });

  return tmpl.evaluate()
    .setTitle(`尺八道場 ${group.label}`)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * API endpoint: record access from LIFF (POST JSON)
 * expected payload: { userId, displayName?, bambooName? }
 */
function doPost(e) {
  // Simple test: write to sheet immediately
  try {
    const ss = SpreadsheetApp.openById(CONFIG.memberSheetId);
    let logSheet = ss.getSheetByName("ログ");
    if (!logSheet) {
      logSheet = ss.insertSheet("ログ");
      logSheet.appendRow(["タイムスタンプ", "メッセージ", "詳細"]);
    }
    
    const timestamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
    logSheet.appendRow([timestamp, "doPost called", JSON.stringify(e)]);
    
    const body = e && e.postData && e.postData.contents ? e.postData.contents : "";
    logSheet.appendRow([timestamp, "POST body", body]);
    
    const payload = body ? JSON.parse(body) : {};
    logSheet.appendRow([timestamp, "Parsed payload", JSON.stringify(payload)]);
    
    const result = recordUserAccess_(payload);
    logSheet.appendRow([timestamp, "recordUserAccess_ result", result]);
    
    return ContentService
      .createTextOutput(JSON.stringify({ status: "ok", result }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    const ss = SpreadsheetApp.openById(CONFIG.memberSheetId);
    let logSheet = ss.getSheetByName("ログ");
    if (!logSheet) {
      logSheet = ss.insertSheet("ログ");
      logSheet.appendRow(["タイムスタンプ", "メッセージ", "詳細"]);
    }
    const timestamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
    logSheet.appendRow([timestamp, "doPost error", err.toString()]);
    
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: err && err.message ? err.message : String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
