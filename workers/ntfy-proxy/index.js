// ============================================================
// Cloudflare Worker: ntfy.sh プロキシ
// GAS → このWorker → ntfy.sh の順に中継する
// ============================================================

const NTFY_TOPICS = {
  '4階病棟': 'sos-byoin-4f',
  '5階病棟': 'sos-byoin-5f',
  '6階病棟': 'sos-byoin-6f',
  '7階病棟': 'sos-byoin-7f',
  '8階病棟': 'sos-byoin-8f'
};

export default {
  async fetch(request) {

    // CORS対応
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    try {
      const data = await request.json();
      const { ward, roomNumber, extension } = data;

      const topic = NTFY_TOPICS[ward];
      if (!topic) {
        return new Response(JSON.stringify({ error: '不明な病棟: ' + ward }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      const room = roomNumber === '不明/緊急' ? '緊急（部屋不明）' : roomNumber + '号室';
      const ext  = extension ? ' 内線' + extension : '';

      const ntfyRes = await fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        headers: {
          'Title':    `🚨 SOS発生 — ${ward}`,
          'Priority': 'urgent',
          'Tags':     'rotating_light,sos',
        },
        body: `${room}${ext}に応援をお願いします`
      });

      return new Response(JSON.stringify({ success: true, ntfyStatus: ntfyRes.status }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};
