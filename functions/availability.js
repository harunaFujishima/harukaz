/**
 * HARUKAZ — Google Calendar Availability
 * Cloudflare Pages Function
 *
 * Cloudflare Dashboard → Pages → Project → Settings → Environment Variables:
 *   GOOGLE_CLIENT_ID      ← OAuthクライアントID
 *   GOOGLE_CLIENT_SECRET  ← OAuthクライアントシークレット
 *   GOOGLE_REFRESH_TOKEN  ← 取得済みのリフレッシュトークン
 *   GOOGLE_CALENDAR_ID    ← カレンダーID
 */

const BIZ = {
  days:      [1, 2, 3, 4, 5, 6], // 1=月 〜 6=土
  startHour: 7,
  endHour:   14,  // 最終枠（60分セッション → 15:00終了）
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

/* ── 全営業スロット生成（60日分） ── */
function generateAllSlots() {
  const slots   = [];
  const minDate = new Date(MIN_DATE_STR + 'T00:00:00');

  for (let i = 0; i <= 60; i++) {
    const d   = new Date(minDate.getTime() + i * 86400000);
    const dow = d.getUTCDay(); // UTC基準（サーバーはUTC）

    // トロント現地曜日を文字列から取得
    const localDow = Number(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto', weekday: 'short'
    }).format(d).replace(/[^0-6]/g, '') || (() => {
      const map = { Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6 };
      return map[new Intl.DateTimeFormat('en-CA', { timeZone:'America/Toronto', weekday:'short' }).format(d)];
    })());

    // 曜日マップ
    const shortDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto', weekday: 'short'
    }).format(d);
    const dowLocal = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[shortDay];

    if (!BIZ.days.includes(dowLocal)) continue;

    const dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d); // "2026-07-20"

    for (let h = BIZ.startHour; h <= BIZ.endHour; h++) {
      const minArr = h === BIZ.endHour ? [0] : [0, 30];
      for (const m of minArr) {
        const hh   = String(h).padStart(2, '0');
        const mm   = String(m).padStart(2, '0');
        const endH = String(h + Math.floor((m + 60) / 60)).padStart(2, '0');
        const endM = String((m + 60) % 60).padStart(2, '0');

        slots.push({
          startISO: `${dateStr}T${hh}:${mm}:00`,
          endISO:   `${dateStr}T${endH}:${endM}:00`,
        });
      }
    }
  }
  return slots;
}

/* ── Cloudflare Pages Function ── */
export async function onRequestGet(context) {
  const { env } = context;
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  };

  try {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CALENDAR_ID) {
      throw new Error('環境変数が未設定です。Cloudflare Dashboard を確認してください。');
    }

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

    return new Response(JSON.stringify({ slots: available }), { headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers,
    });
  }
}
