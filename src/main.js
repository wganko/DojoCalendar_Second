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
  try {
    const body = e && e.postData && e.postData.contents ? e.postData.contents : "";
    const payload = body ? JSON.parse(body) : {};
    const result = recordUserAccess_(payload);
    return ContentService
      .createTextOutput(JSON.stringify({ status: "ok", result }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: err && err.message ? err.message : String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
