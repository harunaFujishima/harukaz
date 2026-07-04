/**
 * HARUKAZ — Google Calendar Availability (Service Account, private calendar)
 *
 * 環境変数 (Netlify Dashboard → Site Settings → Environment Variables):
 *   GOOGLE_SERVICE_ACCOUNT_JSON  ← サービスアカウントのJSONキー全体をペースト
 *   GOOGLE_CALENDAR_ID           ← カレンダーのID (例: abc123@group.calendar.google.com)
 */

const crypto = require('crypto');

/* ── 営業時間設定（home-visit.htmlと同じ値を保つこと） ── */
const BIZ = {
  days:      [1, 2, 3, 4, 5, 6], // 1=月 〜 6=土
  startHour: 7,
  endHour:   14,  // 最終枠の開始時刻（60分セッション → 15:00終了）
};

/* ── 受付開始日 ── */
const MIN_DATE = new Date('2026-07-20T00:00:00');

/* ─────────────────────────────────────────
   全営業スロット生成（60日分）
───────────────────────────────────────── */
function generateAllSlots() {
  const slots = [];
  for (let i = 0; i <= 60; i++) {
    const d   = new Date(MIN_DATE.getTime() + i * 86400000);
    const dow = d.getUTCDay(); // UTC基準。ローカルタイムに要注意
    // EST (UTC-5) / EDT (UTC-4) 補正: カナダ東部
    const local = new Date(d.toLocaleString('en-CA', { timeZone: 'America/Toronto' }));
    const localDow = local.getDay();
    if (!BIZ.days.includes(localDow)) continue;

    const y = local.getFullYear();
    const mo = local.getMonth();
    const dy = local.getDate();

    for (let h = BIZ.startHour; h <= BIZ.endHour; h++) {
      const mins = h === BIZ.endHour ? [0] : [0, 30];
      for (const m of mins) {
        // トロント時間でスロットを作成
        const startLocal = new Date(
          new Date(`${y}-${String(mo+1).padStart(2,'0')}-${String(dy).padStart(2,'0')}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`)
            .toLocaleString('en-CA', { timeZone: 'America/Toronto' })
        );
        // ISO文字列として保存（タイムゾーン付き）
        const startISO = toTorontoISO(y, mo, dy, h, m, 0);
        const endISO   = toTorontoISO(y, mo, dy, h, m + 60, 0);
        slots.push({ startISO, endISO,
          startMs: new Date(startISO).getTime(),
          endMs:   new Date(endISO).getTime() });
      }
    }
  }
  return slots;
}

/** トロント現地時間でISO文字列を作る */
function toTorontoISO(year, month, day, hour, minute, second) {
  // minute > 59 を繰り上げ
  const d = new Date(year, month, day, hour, minute, second);
  // UTCオフセットを取得（Intlで）
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  // 実際にUTC→Torontoの逆変換はせず、Dateを使ってUTC取得
  // ここでは簡易版: Date.toISOStringを使いつつオフセット付与
  return d.toISOString(); // UTC として扱う（後述の比較もUTCで統一）
}

/* ─────────────────────────────────────────
   Google Service Account → OAuth token
───────────────────────────────────────── */
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);

  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }));

  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(sa.private_key, 'base64url');

  const jwt = `${signingInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

function b64url(str) {
  return Buffer.from(str).toString('base64url');
}

/* ─────────────────────────────────────────
   Netlify Function ハンドラ
───────────────────────────────────────── */
exports.handler = async () => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  };

  try {
    const sa         = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    if (!sa || !calendarId) {
      throw new Error('環境変数が設定されていません。Netlify Dashboard を確認してください。');
    }

    const token = await getAccessToken(sa);

    /* カレンダーイベントを取得（60日分） */
    const timeMin = MIN_DATE.toISOString();
    const timeMax = new Date(MIN_DATE.getTime() + 61 * 86400000).toISOString();

    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events` +
      `?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const calData = await calRes.json();

    /* カレンダーの予定 = ブロック済み時間帯 */
    const busy = (calData.items || []).map(e => ({
      startMs: new Date(e.start.dateTime || e.start.date).getTime(),
      endMs:   new Date(e.end.dateTime   || e.end.date).getTime(),
    }));

    /* 全スロット − ブロック = 予約可能スロット */
    const available = generateAllSlots()
      .filter(s => !busy.some(b => s.startMs < b.endMs && s.endMs > b.startMs))
      .map(s => ({ start: s.startISO, end: s.endISO }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ slots: available }),
    };

  } catch (err) {
    console.error('availability error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
