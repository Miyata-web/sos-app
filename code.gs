// ============================================================
// 設定：デプロイ前にここを編集する
// ============================================================
const SPREADSHEET_ID = '1JTk_Bra0tgfhc1Af1FAXkPiZGma-y_z7-6RKVV80SWc';
const SHEET_NAME     = 'SOS記録';

// ntfy.sh トピック（病棟ごとに固有の名前を設定）
const NTFY_TOPICS = {
  '4階病棟': 'sos-byoin-4f',
  '5階病棟': 'sos-byoin-5f',
  '6階病棟': 'sos-byoin-6f',
  '7階病棟': 'sos-byoin-7f',
  '8階病棟': 'sos-byoin-8f'
};

// メール通知（使う場合はコメントを外してアドレスを設定）
// const NOTIFY_EMAIL = 'your-email@example.com';

// Slack Webhook（使う場合はコメントを外してURLを設定）
// const SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/XXXXX';

// ============================================================
// POST受信：SOS記録
// ============================================================
function doPost(e) {
  try {
    const data  = JSON.parse(e.postData.contents);
    const sheet = getOrCreateSheet();

    sheet.appendRow([
      new Date(data.timestamp),   // 発生時刻
      data.ward        || '',     // 病棟
      data.roomNumber  || '',     // 部屋番号
      new Date()                  // 記録時刻
    ]);

    // ntfy.sh プッシュ通知
    sendNtfy(data);

    // メール通知（使う場合はコメントを外す）
    // sendEmail(data);
    // Slack通知（使う場合はコメントを外す）
    // sendSlack(data);

    return jsonResponse({ success: true });

  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// ============================================================
// GET受信：受信モード用ポーリング
// ============================================================
function doGet(e) {
  try {
    const action = e.parameter.action;
    const ward   = e.parameter.ward   || '';
    const since  = e.parameter.since  ? new Date(e.parameter.since) : new Date(0);

    if (action !== 'check') {
      return jsonResponse({ error: 'Unknown action' });
    }

    const sheet  = getOrCreateSheet();
    const rows   = sheet.getDataRange().getValues();
    const events = [];

    for (let i = 1; i < rows.length; i++) {
      const [timestamp, rowWard, roomNumber] = rows[i];
      if (rowWard === ward && new Date(timestamp) > since) {
        events.push({ timestamp, ward: rowWard, roomNumber });
      }
    }

    // 新しい順に並べる
    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return jsonResponse({ events });

  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ============================================================
// スプレッドシート取得（なければ作成）
// ============================================================
function getOrCreateSheet() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  let   sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const header = sheet.getRange(1, 1, 1, 4);
    header.setValues([['発生時刻', '病棟', '部屋番号', '記録時刻']]);
    header.setBackground('#b71c1c');
    header.setFontColor('#ffffff');
    header.setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 120);
    sheet.setColumnWidth(3, 100);
    sheet.setColumnWidth(4, 160);
  }

  return sheet;
}

// ============================================================
// ntfy.sh プッシュ通知
// ============================================================
function sendNtfy(data) {
  const topic = NTFY_TOPICS[data.ward];
  if (!topic) return;
  const room = data.roomNumber === '不明/緊急' ? '緊急（部屋不明）' : data.roomNumber + '号室';
  UrlFetchApp.fetch(`https://ntfy.sh/${topic}`, {
    method:  'POST',
    headers: {
      'Title':    `🚨 SOS発生 — ${data.ward}`,
      'Message':  `${room}`,
      'Priority': 'urgent',
      'Tags':     'rotating_light'
    },
    payload: `${data.ward} / ${room}`
  });
}

// ============================================================
// メール通知（雛形）
// ============================================================
function sendEmail(data) {
  const time = new Date(data.timestamp).toLocaleString('ja-JP');
  const room = data.roomNumber === '不明/緊急' ? '不明/緊急' : data.roomNumber + '号室';
  GmailApp.sendEmail(
    NOTIFY_EMAIL,
    `🚨 SOS発生 — ${data.ward} ${room}`,
    `スタッフ: ${data.staffName}\n病棟: ${data.ward}\n部屋: ${room}\n発生時刻: ${time}`
  );
}

// ============================================================
// Slack通知（雛形）
// ============================================================
function sendSlack(data) {
  const time = new Date(data.timestamp).toLocaleString('ja-JP');
  const room = data.roomNumber === '不明/緊急' ? '不明/緊急' : data.roomNumber + '号室';
  UrlFetchApp.fetch(SLACK_WEBHOOK_URL, {
    method:      'POST',
    contentType: 'application/json',
    payload: JSON.stringify({
      text: `🚨 *SOS発生！*\n*スタッフ:* ${data.staffName}\n*病棟:* ${data.ward}\n*部屋:* ${room}\n*時刻:* ${time}`
    })
  });
}

// ============================================================
// ユーティリティ
// ============================================================
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
