// ============================================================
// 院内SOS Cloudflare Worker
//   - POST /log  : 発報ログをKVに保存（匿名・URLが秘匿情報として機能）
//   - GET  /logs : 保存済みログの閲覧（Basic認証保護）
//   - POST /     : 旧・ntfy中継エンドポイント（現在は未使用。将来のntfy Pro導入時用に温存）
// 環境変数（Secret）:
//   CLIENT_TOKEN    : Bearer認証用（POST /）
//   NTFY_TOKEN      : ntfy.sh側の認証トークン（POST /）
//   LOG_USER        : /logs閲覧用のBasic認証ユーザー名
//   LOG_PASS        : /logs閲覧用のBasic認証パスワード
// KVバインディング:
//   SOS_LOG : 発報ログ格納
// ============================================================

const WARD_TOPICS = {
  '4階病棟':   'sos-4f-46c7d16ihj',
  '5階病棟':   'sos-5f-1ubk7s5l8w',
  '6階病棟':   'sos-6f-9er798nkq1',
  '7階病棟':   'sos-7f-tbm7u01sxa',
  '8階病棟':   'sos-8f-9ba6vhm67k',
  'ICU':      'sos-icu-37d34f04f4',
  'HCU':      'sos-hcu-298b6e89a8',
  'ER':       'sos-er-5869dc935a',
  '外来':     'sos-op-9e3cb90c96',
  'その他部署': 'sos-oth-1537f5d775',
};
const NIGHT_TOPIC = 'sos-night-73zikbkv0x';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

// ============================================================
// 発報ログ書込（匿名）: POST /log
// body: { ward, roomNumber, extension }
// ============================================================
async function handleLogWrite(request, env) {
  if (!env.SOS_LOG) return json({ error: 'KV not bound' }, 500);
  let data;
  try { data = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const record = {
    timestamp:  new Date().toISOString(),
    ward:       String(data.ward || ''),
    roomNumber: String(data.roomNumber || ''),
    extension:  String(data.extension || ''),
  };
  // 病棟妥当性の軽い検証（不正投稿の抑制）
  if (!record.ward || !WARD_TOPICS[record.ward]) {
    return json({ error: 'Unknown ward' }, 400);
  }
  // タイムスタンプ降順でリストしやすいキー: 逆順時刻+ランダム
  const inv = (9999999999999 - Date.now()).toString().padStart(13, '0');
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `${inv}-${rand}`;
  await env.SOS_LOG.put(key, JSON.stringify(record));
  return json({ success: true });
}

// ============================================================
// 発報ログ閲覧（Basic認証）: GET /logs
// クエリ: ?limit=100 (default 200)
// ============================================================
function unauthorized() {
  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="SOS Log Viewer", charset="UTF-8"',
      'Content-Type':     'text/plain; charset=utf-8',
    },
  });
}

function checkBasicAuth(request, env) {
  const expectedUser = env.LOG_USER;
  const expectedPass = env.LOG_PASS;
  if (!expectedUser || !expectedPass) return false;
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Basic ')) return false;
  try {
    const decoded = atob(auth.slice(6));
    const idx = decoded.indexOf(':');
    if (idx < 0) return false;
    return decoded.slice(0, idx) === expectedUser
        && decoded.slice(idx + 1) === expectedPass;
  } catch { return false; }
}

async function handleLogList(request, env) {
  if (!env.SOS_LOG) return new Response('KV not bound', { status: 500 });
  if (!checkBasicAuth(request, env)) return unauthorized();

  const url    = new URL(request.url);
  const limit  = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), 1000);
  const format = url.searchParams.get('format') || 'html';

  const list = await env.SOS_LOG.list({ limit });
  const items = await Promise.all(list.keys.map(async k => {
    const v = await env.SOS_LOG.get(k.name);
    try { return JSON.parse(v); } catch { return null; }
  }));
  const records = items.filter(Boolean);

  if (format === 'json') {
    return new Response(JSON.stringify(records, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  if (format === 'csv') {
    const header = 'timestamp,ward,roomNumber,extension';
    const rows = records.map(r =>
      [r.timestamp, r.ward, r.roomNumber, r.extension]
        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );
    return new Response('﻿' + [header, ...rows].join('\n'), {
      headers: {
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sos_log.csv"',
      },
    });
  }
  // default: HTML
  const rowsHtml = records.map(r => `
    <tr>
      <td>${escapeHtml(r.timestamp)}</td>
      <td>${escapeHtml(r.ward)}</td>
      <td>${escapeHtml(r.roomNumber)}</td>
      <td>${escapeHtml(r.extension)}</td>
    </tr>`).join('');
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>院内SOS 発報ログ</title>
<style>
  body{font-family:-apple-system,"Hiragino Sans","Yu Gothic",sans-serif;max-width:1000px;margin:24px auto;padding:0 16px;color:#111;background:#f7f7f9}
  h1{font-size:20px;border-bottom:2px solid #b91c1c;padding-bottom:6px}
  .meta{color:#555;font-size:13px;margin-bottom:12px}
  table{border-collapse:collapse;width:100%;font-size:14px;background:#fff}
  th,td{border:1px solid #d1d5db;padding:6px 10px;text-align:left;vertical-align:top}
  th{background:#fee2e2}
  .links a{margin-right:12px;color:#0369a1}
</style></head><body>
<h1>🚨 院内SOS 発報ログ</h1>
<p class="meta">最新 ${records.length} 件（新しい順）
  <span class="links">
    <a href="?format=csv&limit=${limit}">CSVダウンロード</a>
    <a href="?format=json&limit=${limit}">JSON表示</a>
  </span>
</p>
<table>
  <thead><tr><th>発生時刻</th><th>エリア</th><th>部屋番号</th><th>端末識別名</th></tr></thead>
  <tbody>${rowsHtml || '<tr><td colspan="4" style="text-align:center;color:#888">記録なし</td></tr>'}</tbody>
</table>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}

// ============================================================
// 旧・ntfy中継（POST /）: 現在Web/ショートカットからは呼ばれない
// 将来のntfy Pro契約時などに再有効化するため温存
// ============================================================
async function handleNtfyForward(request, env) {
  const expected = env.CLIENT_TOKEN;
  if (!expected) return json({ error: 'CLIENT_TOKEN not set' }, 500);
  const auth = request.headers.get('Authorization') || '';
  if (auth !== `Bearer ${expected}`) return json({ error: 'Unauthorized' }, 401);

  let data;
  try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const ward       = data.ward       || '';
  const roomNumber = data.roomNumber || '不明/緊急';
  const extension  = data.extension  || '';
  const topic      = WARD_TOPICS[ward];
  if (!topic) return json({ error: '不明な病棟: ' + ward }, 400);

  const room    = roomNumber === '不明/緊急' ? '緊急（部屋不明）' : roomNumber + '号室';
  const ext     = extension ? ' 内線:' + extension : '';
  const title   = 'SOS発生 ' + ward;
  const message = room + 'に応援をお願いします' + ext;

  const ntfyHeaders = { 'Content-Type': 'application/json' };
  if (env.NTFY_TOKEN) ntfyHeaders['Authorization'] = 'Bearer ' + env.NTFY_TOKEN;

  const targets = [topic, NIGHT_TOPIC];
  const results = await Promise.all(targets.map(async t => {
    try {
      const res = await fetch('https://ntfy.sh/', {
        method: 'POST', headers: ntfyHeaders,
        body: JSON.stringify({
          topic: t, title, message, priority: 5, tags: ['rotating_light', 'sos'],
        }),
      });
      return { topic: t, status: res.status };
    } catch (err) { return { topic: t, error: err.message }; }
  }));
  const allOk = results.every(r => r.status === 200);
  return json({ success: allOk, results }, allOk ? 200 : 502);
}

// ============================================================
// エントリポイント
// ============================================================
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

    const url  = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'POST' && path === '/log')  return handleLogWrite(request, env);
    if (request.method === 'GET'  && path === '/logs') return handleLogList(request, env);
    if (request.method === 'POST' && path === '/')     return handleNtfyForward(request, env);

    return json({ error: 'Not found' }, 404);
  },
};
