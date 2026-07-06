/**
 * HARUKAZ — Calendar Availability Worker
 * Cloudflare Dashboard のエディタにこのコードを貼り付けて使用
 *
 * 環境変数（Worker の Settings → Variables）:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 *   GOOGLE_CALENDAR_ID
 */

const BIZ = {
  days:      [1, 2, 3, 4, 5, 6], // 1=月 〜 6=土
  startHour: 7,
  endHour:   14, // 最終枠（60分セッション → 15:00終了）
};

const MIN_DATE_STR = '2026-07-20';

/* ── アクセストークン取得 ── */
async function getAccessToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

/* ── 全営業スロット生成（60日分）── */
function generateAllSlots() {
  const slots   = [];
  const minDate = new Date(MIN_DATE_STR + 'T12:00:00Z'); // UTC正午基準

  for (let i = 0; i <= 60; i++) {
    const d = new Date(minDate.getTime() + i * 86400000);

    const shortDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto', weekday: 'short'
    }).format(d);
    const dow = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[shortDay];
    if (!BIZ.days.includes(dow)) continue;

    const dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d);

    // Toronto UTC offset: EDT = -04:00 (Mar-Nov), EST = -05:00 (Nov-Mar)
    const tzName = new Intl.DateTimeFormat('en', {
      timeZone: 'America/Toronto', timeZoneName: 'shortOffset'
    }).formatToParts(d).find(p => p.type === 'timeZoneName').value; // "GMT-4"
    const offsetMatch = tzName.match(/GMT([+-]\d+)/);
    const offsetHours = offsetMatch ? parseInt(offsetMatch[1]) : -4;
    const tzSuffix = offsetHours < 0
      ? `-${String(Math.abs(offsetHours)).padStart(2,'0')}:00`
      : `+${String(offsetHours).padStart(2,'0')}:00`;

    for (let h = BIZ.startHour; h <= BIZ.endHour; h++) {
      const minArr = h === BIZ.endHour ? [0] : [0, 30];
      for (const m of minArr) {
        const hh   = String(h).padStart(2, '0');
        const mm   = String(m).padStart(2, '0');
        const endH = String(h + Math.floor((m + 60) / 60)).padStart(2, '0');
        const endM = String((m + 60) % 60).padStart(2, '0');
        slots.push({
          startISO: `${dateStr}T${hh}:${mm}:00${tzSuffix}`,
          endISO:   `${dateStr}T${endH}:${endM}:00${tzSuffix}`,
        });
      }
    }
  }
  return slots;
}

/* ── Worker エントリポイント ── */
export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const token = await getAccessToken(env);

      const timeMin = new Date(MIN_DATE_STR + 'T00:00:00').toISOString();
      const timeMax = new Date(new Date(MIN_DATE_STR).getTime() + 61 * 86400000).toISOString();

      const calRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/` +
        `${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events` +
        `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
        `&singleEvents=true&orderBy=startTime`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const calData = await calRes.json();
      if (calData.error) throw new Error(JSON.stringify(calData.error));

      /* カレンダーの予定 = ブロック時間帯 */
      const busy = (calData.items || []).map(e => ({
        start: new Date(e.start.dateTime || e.start.date + 'T00:00:00'),
        end:   new Date(e.end.dateTime   || e.end.date   + 'T00:00:00'),
      }));

      /* 全スロット − ブロック = 予約可能 */
      const available = generateAllSlots()
        .filter(s => {
          const sStart = new Date(s.startISO);
          const sEnd   = new Date(s.endISO);
          return !busy.some(b => sStart < b.end && sEnd > b.start);
        })
        .map(s => ({ start: s.startISO, end: s.endISO }));

      return new Response(JSON.stringify({ slots: available }), { headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: corsHeaders,
      });
    }
  }
};
