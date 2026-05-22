const SPREADSHEET_ID = '1JTk_Bra0tgfhc1Af1FAXkPiZGma-y_z7-6RKVV80SWc';
const SHEET_NAME     = 'SOS記録';

// ============================================================
// POST受信：SOS記録（Webアプリからの送信）
// ============================================================
function doPost(e) {
  try {
    const data  = JSON.parse(e.postData.contents);
    const sheet = getOrCreateSheet();
    const ntfyStatus = sendNtfy(data);
    sheet.appendRow([
      new Date(data.timestamp),
      data.ward        || '',
      data.roomNumber  || '',
      data.extension   || '',
      new Date(),
      ntfyStatus
    ]);
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// ============================================================
// GET受信：ショートカット送信 & 受信ポーリング
// ============================================================
function doGet(e) {
  try {
    const action     = e.parameter.action;
    const ward       = e.parameter.ward       || '';
    const roomNumber = e.parameter.roomNumber || '不明/緊急';
    const since      = e.parameter.since ? new Date(e.parameter.since) : new Date(0);

    if (action === 'sos') {
      const extension  = e.parameter.extension || '';
      const sheet      = getOrCreateSheet();
      const now        = new Date();
      const ntfyStatus = sendNtfy({ ward, roomNumber, extension, timestamp: now.toISOString() });
      sheet.appendRow([now, ward, roomNumber, extension, now, ntfyStatus]);
      return jsonResponse({ success: true, ntfyStatus });
    }

    if (action === 'check') {
      const sheet  = getOrCreateSheet();
      const rows   = sheet.getDataRange().getValues();
      const events = [];
      for (let i = 1; i < rows.length; i++) {
        const [timestamp, rowWard, rowRoom, rowExt] = rows[i];
        if (rowWard === ward && new Date(timestamp) > since) {
          events.push({ timestamp, ward: rowWard, roomNumber: rowRoom, extension: rowExt || '' });
        }
      }
      events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      return jsonResponse({ events });
    }

    return jsonResponse({ error: 'Unknown action' });

  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ============================================================
// スプレッドシート取得
// ============================================================
function getOrCreateSheet() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  let   sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const header = sheet.getRange(1, 1, 1, 6);
    header.setValues([['発生時刻', '病棟', '部屋番号', '内線番号', '記録時刻', '通知状態']]);
    header.setBackground('#b71c1c');
    header.setFontColor('#ffffff');
    header.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ============================================================
// Cloudflare Worker経由でntfy.shに通知
// 戻り値：通知結果メッセージ（スプシに記録）
// ============================================================
function sendNtfy(data) {
  try {
    const res  = UrlFetchApp.fetch('https://sos-ntfy-proxy.mx1vm1122.workers.dev/', {
      method:               'POST',
      contentType:          'application/json',
      payload:              JSON.stringify({
        ward:       data.ward       || '',
        roomNumber: data.roomNumber || '不明/緊急',
        extension:  data.extension  || ''
      }),
      muteHttpExceptions:   true
    });
    const body   = JSON.parse(res.getContentText());
    const status = body.ntfyStatus || res.getResponseCode();
    if (status === 200) return '通知OK';
    return '通知NG(' + status + ')';
  } catch (err) {
    return 'エラー:' + err.message;
  }
}

// ============================================================
// ユーティリティ
// ============================================================
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
