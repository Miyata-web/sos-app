const SPREADSHEET_ID = '1JTk_Bra0tgfhc1Af1FAXkPiZGma-y_z7-6RKVV80SWc';
const SHEET_NAME     = 'SOS記録';

const NTFY_TOPICS = {
  '4階病棟': 'sos-byoin-4f',
  '5階病棟': 'sos-byoin-5f',
  '6階病棟': 'sos-byoin-6f',
  '7階病棟': 'sos-byoin-7f',
  '8階病棟': 'sos-byoin-8f'
};

function doPost(e) {
  try {
    const data  = JSON.parse(e.postData.contents);
    const sheet = getOrCreateSheet();
    sheet.appendRow([new Date(data.timestamp), data.ward || '', data.roomNumber || '', data.extension || '', new Date()]);
    try { sendNtfy(data); } catch(ntfyErr) {}
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

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
      sheet.appendRow([now, ward, roomNumber, extension, now]);
      try { sendNtfy({ ward, roomNumber, extension, timestamp: now.toISOString() }); } catch(ntfyErr) {}
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

function getOrCreateSheet() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  let   sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const header = sheet.getRange(1, 1, 1, 4);
    header.setValues([['発生時刻', '病棟', '部屋番号', '内線番号', '記録時刻']]);
    header.offset(0, 0, 1, 5);
    header.setBackground('#b71c1c');
    header.setFontColor('#ffffff');
    header.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function sendNtfy(data) {
  const topic = NTFY_TOPICS[data.ward];
  if (!topic) return;
  const room = data.roomNumber === '不明/緊急' ? '緊急（部屋不明）' : data.roomNumber + '号室';
  const ext  = data.extension ? ' 内線' + data.extension : '';
  UrlFetchApp.fetch('https://ntfy.sh/' + topic, {
    method:  'POST',
    headers: {
      'Title':    '🚨 SOS発生 — ' + data.ward,
      'Priority': 'urgent',
      'Tags':     'rotating_light,sos',
      'Sound':    'ding'
    },
    payload: room + ext + 'に応援をお願いします'
  });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}