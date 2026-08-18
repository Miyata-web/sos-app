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
      const extension = e.parameter.extension || '';
      const sheet     = getOrCreateSheet();
      const now       = new Date();
      // アプリ・ショートカットがTelegramへ直接送信するためGAS側は記録のみ
      sheet.appendRow([now, ward, roomNumber, extension, now, 'アプリ送信']);
      return jsonResponse({ success: true });
    }

    // アプリからのログ記録のみ（Telegram通知なし・高速化対応）
    if (action === 'log') {
      const extension = e.parameter.extension || '';
      const ts        = e.parameter.timestamp ? new Date(e.parameter.timestamp) : new Date();
      const sheet     = getOrCreateSheet();
      sheet.appendRow([ts, ward, roomNumber, extension, new Date(), 'アプリ送信']);
      return jsonResponse({ success: true });
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
// ntfy.shで通知（iPhoneから直接送信・GASはログのみ）
// 戻り値：通知結果メッセージ（スプシに記録）
// ============================================================
function sendNtfy(data) {
  try {
    const WARD_TOPICS = {
      '4階病棟': 'sos-4f-46c7d16ihj',
      '5階病棟': 'sos-5f-1ubk7s5l8w',
      '6階病棟': 'sos-6f-9er798nkq1',
      '7階病棟': 'sos-7f-tbm7u01sxa',
      '8階病棟': 'sos-8f-9ba6vhm67k',
    };

    const ward       = data.ward       || '不明';
    const roomNumber = data.roomNumber || '不明/緊急';
    const extension  = data.extension  || '';
    const topic      = WARD_TOPICS[ward] || WARD_TOPICS['4階病棟'];
    const room       = roomNumber === '不明/緊急' ? '緊急（部屋不明）' : roomNumber + '号室';
    const message    = room + 'に応援をお願いします' + (extension ? ' 内線:' + extension : '');

    const res = UrlFetchApp.fetch('https://ntfy.sh', {
      method:             'POST',
      contentType:        'application/json',
      payload:            JSON.stringify({
        topic:    topic,
        title:    'SOS発生 ' + ward,
        message:  message,
        priority: 5,
        tags:     ['rotating_light', 'sos']
      }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) return '通知OK';
    return '通知NG(' + res.getResponseCode() + ')';
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
