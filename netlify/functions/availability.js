/**
 * HARUKAZ — Google Calendar Availability
 * OAuth2 refresh token 方式（サービスアカウントキー不要）
 *
 * Netlify Dashboard → Environment Variables に以下を登録:
 *   GOOGLE_CLIENT_ID      ← OAuthクライアントID
 *   GOOGLE_CLIENT_SECRET  ← OAuthクライアントシークレット
 *   GOOGLE_REFRESH_TOKEN  ← OAuth Playgroundで取得したリフレッシュトークン
 *   GOOGLE_CALENDAR_ID    ← カレンダーID (例: xxx@group.calendar.google.com)
 */

/* ── 営業時間設定 ── */
const BIZ = {
  days:      [1, 2, 3, 4, 5, 6], // 1=月 〜 6=土
  startHour: 7,
  endHour:   14,  // 最終枠開始時刻（60分セッション → 15:00終了）
  interval:  30,  // 分刻み
};

const MIN_DATE = new Date('2026-07-20');

/* ─────────────────────────────────────────
   アクセストークン取得（リフレッシュトークンから）
───────────────────────────────────────── */
async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`トークン取得失敗: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

/* ─────────────────────────────────────────
   全営業スロット生成（60日分）
───────────────────────────────────────── */
function generateAllSlots() {
  const slots = [];

  for (let i = 0; i <= 60; i++) {
    const base = new Date(MIN_DATE);
    base.setDate(base.getDate() + i);

    // トロント現地時間で曜日を判定
    const localStr  = base.toLocaleDateString('en-CA', { timeZone: 'America/Toronto', weekday: 'short' });
    const dowMap    = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dow       = dowMap[localStr];
    if (!BIZ.days.includes(dow)) continue;

    const dateStr = base.toLocaleDateString('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }); // → "2026-07-20"

    for (let h = BIZ.startHour; h <= BIZ.endHour; h++) {
      const mins = h === BIZ.endHour ? [0] : [0, 30];
      for (const m of mins) {
        const hh    = String(h).padStart(2, '0');
        const mm    = String(m).padStart(2, '0');
        // トロント現地時間でISO文字列を作る
        const startISO = `${dateStr}T${hh}:${mm}:00`;
        const endH     = h + Math.floor((m + 60) / 60);
        const endM     = (m + 60) % 60;
        const endISO   = `${dateStr}T${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}:00`;

        slots.push({ startISO, endISO });
      }
    }
  }

  return slots;
}

/* ─────────────────────────────────────────
   Netlify Function ハンドラ
───────────────────────────────────────── */
exports.handler = async () => {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  };

  try {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!process.env.GOOGLE_CLIENT_ID || !calendarId) {
      throw new Error('環境変数が未設定です。Netlify Dashboard を確認してください。');
    }

    const token = await getAccessToken();

    /* カレンダーイベントを取得（60日分） */
    const timeMin = new Date(MIN_DATE).toISOString();
    const timeMax = new Date(new Date(MIN_DATE).setDate(MIN_DATE.getDate() + 61)).toISOString();

    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events` +
      `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
      `&singleEvents=true&orderBy=startTime`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const calData = await calRes.json();

    if (calData.error) throw new Error(JSON.stringify(calData.error));

    /* カレンダーの予定 = ブロック時間帯 */
    const busy = (calData.items || []).map(e => ({
      start: new Date(e.start.dateTime || e.start.date),
      end:   new Date(e.end.dateTime   || e.end.date),
    }));

    /* 全スロット − ブロック = 予約可能スロット */
    const allSlots = generateAllSlots();
    const available = allSlots
      .filter(s => {
        const sStart = new Date(s.startISO + ' America/Toronto');
        const sEnd   = new Date(s.endISO   + ' America/Toronto');
        return !busy.some(b => sStart < b.end && sEnd > b.start);
      })
      .map(s => ({ start: s.startISO, end: s.endISO }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ slots: available }),
    };

  } catch (err) {
    console.error('availability error:', err.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
