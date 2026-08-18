// ============================================================
// 院内SOS Cloudflare Worker（中継＋認証）
// クライアント → Worker → ntfy.sh
// クライアントは Authorization: Bearer <CLIENT_TOKEN> を必須で送信すること
// CLIENT_TOKEN は Cloudflare Worker の Secret として登録
// ============================================================

const WARD_TOPICS = {
  '4階病棟': 'sos-4f-46c7d16ihj',
  '5階病棟': 'sos-5f-1ubk7s5l8w',
  '6階病棟': 'sos-6f-9er798nkq1',
  '7階病棟': 'sos-7f-tbm7u01sxa',
  '8階病棟': 'sos-8f-9ba6vhm67k',
};
const NIGHT_TOPIC = 'sos-night-73zikbkv0x';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    // --- クライアント認証 ---
    const expected = env.CLIENT_TOKEN;
    if (!expected) {
      return json({ error: 'Server misconfigured: CLIENT_TOKEN not set' }, 500);
    }
    const auth = request.headers.get('Authorization') || '';
    if (auth !== `Bearer ${expected}`) {
      return json({ error: 'Unauthorized' }, 401);
    }

    // --- リクエスト解析 ---
    let data;
    try {
      data = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const ward       = data.ward       || '';
    const roomNumber = data.roomNumber || '不明/緊急';
    const extension  = data.extension  || '';

    const topic = WARD_TOPICS[ward];
    if (!topic) {
      return json({ error: '不明な病棟: ' + ward }, 400);
    }

    const room    = roomNumber === '不明/緊急' ? '緊急（部屋不明）' : roomNumber + '号室';
    const ext     = extension ? ' 内線:' + extension : '';
    const title   = 'SOS発生 ' + ward;
    const message = room + 'に応援をお願いします' + ext;

    // --- ntfy.sh へfan-out（病棟トピック + 夜間師長トピック）---
    const targets = [topic, NIGHT_TOPIC];
    const results = await Promise.all(targets.map(async t => {
      try {
        const res = await fetch('https://ntfy.sh/', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            topic:    t,
            title,
            message,
            priority: 5,
            tags:     ['rotating_light', 'sos'],
          }),
        });
        return { topic: t, status: res.status };
      } catch (err) {
        return { topic: t, error: err.message };
      }
    }));

    const allOk = results.every(r => r.status === 200);
    return json({ success: allOk, results }, allOk ? 200 : 502);
  },
};
