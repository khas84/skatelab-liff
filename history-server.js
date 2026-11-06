// Admin-only history API for the LIFF viewer.
// Verify the LINE ID token with LINE's endpoint before opening the trial spreadsheet.
// Do not trust userId from the request, and do not decode the token locally.
// Sheet id is supplied by deps.sheetId (GAS: historyTrialSheetId_ in コード.gs). No Gemini calls.

var HIST_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
var HIST_ISS = 'https://access.line.me';
var HIST_PAGE_DEFAULT = 20;
var HIST_PAGE_MAX = 30;
var HIST_PAGE_CAP = 10000;
var HIST_ROW_CAP = 8000;
var HIST_LABEL = '試験用・吉田さんサンプル';

var HIST_MSG = {
  unauthorized: '認証の有効期限が切れているか、LINEアプリから開き直してください。',
  expired: '認証の有効期限が切れました。LINEアプリから開き直してください。',
  forbidden: 'この履歴を表示する権限がありません。',
  unavailable: '履歴を読み込めませんでした。しばらくしてからもう一度お試しください。'
};

function histError_(code) {
  return { status: 'error', code: code, message: HIST_MSG[code] || HIST_MSG.unavailable };
}

function histSafeEqual_(a, b) {
  var x = String(a || '');
  var y = String(b || '');
  if (x.length !== y.length) return false;
  var r = 0;
  for (var i = 0; i < x.length; i++) r |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return r === 0;
}

function histLog_(deps, message) {
  try {
    if (deps && typeof deps.log === 'function') deps.log(String(message || ''));
    else console.error(String(message || ''));
  } catch (e) { /* ignore */ }
}

function histExpectedChannel_(deps) {
  var props = deps && deps.props;
  if (!props || typeof props.getProperty !== 'function') return '';
  var configured = String(props.getProperty('LINE_LOGIN_CHANNEL_ID') || '').trim();
  var liffId = String((deps && deps.liffId) || '').trim();
  var prefix = liffId.split('-')[0];
  if (!configured || !prefix || configured !== prefix) return '';
  return configured;
}

function histAdminId_(deps) {
  var props = deps && deps.props;
  if (!props || typeof props.getProperty !== 'function') return '';
  return String(props.getProperty('ADMIN_LINE_USER_ID') || '').trim();
}

function histResponseCode_(res) {
  if (res && typeof res.getResponseCode === 'function') return Number(res.getResponseCode());
  return 0;
}

function histResponseText_(res) {
  if (res && typeof res.getContentText === 'function') return String(res.getContentText() || '');
  return '';
}

function histFailureCode_(bodyText) {
  var desc = '';
  try { desc = String((JSON.parse(bodyText) || {}).error_description || ''); } catch (e) { desc = ''; }
  if (/expired/i.test(desc)) return 'expired';
  return 'unauthorized';
}

function histCheckClaims_(claims, channelId, nowSec) {
  if (!claims || typeof claims !== 'object') return 'unauthorized';
  if (claims.iss !== HIST_ISS) return 'unauthorized';
  if (String(claims.aud == null ? '' : claims.aud) !== String(channelId)) return 'unauthorized';
  var exp = Number(claims.exp);
  if (!isFinite(exp) || exp <= Number(nowSec)) return 'expired';
  var sub = String(claims.sub || '').trim();
  if (!/^U[0-9a-f]{32}$/.test(sub)) return 'unauthorized';
  return '';
}

function histAuthorize_(requestData, deps) {
  var adminId = histAdminId_(deps);
  if (!adminId) return { ok: false, error: histError_('forbidden') };

  var channelId = histExpectedChannel_(deps);
  if (!channelId) return { ok: false, error: histError_('unauthorized') };

  var idToken = String((requestData && requestData.idToken) || '').trim();
  if (!idToken || idToken.length > 8000) return { ok: false, error: histError_('unauthorized') };

  var nowSec = (deps && typeof deps.nowSec === 'function') ? Number(deps.nowSec()) : Math.floor(Date.now() / 1000);
  var res;
  try {
    res = deps.fetchUrl(HIST_VERIFY_URL, {
      method: 'post',
      payload: { id_token: idToken, client_id: channelId },
      muteHttpExceptions: true
    });
  } catch (e) {
    return { ok: false, error: histError_('unauthorized') };
  }

  var code = histResponseCode_(res);
  var bodyText = histResponseText_(res);
  if (code !== 200) return { ok: false, error: histError_(histFailureCode_(bodyText)) };

  var claims;
  try { claims = JSON.parse(bodyText); } catch (e2) { return { ok: false, error: histError_('unauthorized') }; }
  var claimError = histCheckClaims_(claims, channelId, nowSec);
  if (claimError) return { ok: false, error: histError_(claimError) };

  var sub = String(claims.sub).trim();
  if (!histSafeEqual_(sub, adminId)) return { ok: false, error: histError_('forbidden') };
  return { ok: true, userId: sub };
}

function histNormHeader_(value) {
  return String(value == null ? '' : value).replace(/^\uFEFF/, '').trim().split(/[\s(（]/)[0].toLowerCase();
}

function histFindCol_(headers, aliases) {
  for (var a = 0; a < aliases.length; a++) {
    for (var c = 0; c < headers.length; c++) {
      if (histNormHeader_(headers[c]) === aliases[a]) return c;
    }
  }
  return -1;
}

function histHeaderPreview_(headers) {
  return (headers || []).slice(0, 8).map(function(h) {
    return histNormHeader_(h).slice(0, 40);
  }).join(' | ');
}

function histHeaderRowIndex_(values) {
  var markers = { '日付': 1, '日時': 1, '作業内容': 1, '本文': 1, 'メッセージ': 1, 'タイムスタンプ': 1 };
  var limit = Math.min(values.length, 8);
  for (var r = 0; r < limit; r++) {
    var row = values[r] || [];
    for (var c = 0; c < row.length; c++) {
      if (markers[histNormHeader_(row[c])]) return r;
    }
  }
  return -1;
}

function histText_(value) {
  if (value == null) return '';
  if (value instanceof Date) return '';
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function histSortKey_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.getTime();
  var s = histText_(value);
  if (!s) return null;
  var m = s.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  var mo = ('0' + m[2]).slice(-2);
  var d = ('0' + m[3]).slice(-2);
  var hh = ('0' + (m[4] || '0')).slice(-2);
  var mm = ('0' + (m[5] || '0')).slice(-2);
  var ss = ('0' + (m[6] || '0')).slice(-2);
  var t = Date.parse(m[1] + '-' + mo + '-' + d + 'T' + hh + ':' + mm + ':' + ss + '+09:00');
  return isNaN(t) ? null : t;
}

function histFormatDay_(value, deps) {
  if (value instanceof Date && !isNaN(value.getTime()) && deps && typeof deps.formatDay === 'function') {
    return String(deps.formatDay(value));
  }
  return histText_(value);
}

function histFormatDateTime_(value, deps) {
  if (value instanceof Date && !isNaN(value.getTime()) && deps && typeof deps.formatDateTime === 'function') {
    return String(deps.formatDateTime(value));
  }
  return histText_(value);
}

function histCompare_(direction, a, b) {
  var ak = a.sortKey;
  var bk = b.sortKey;
  if (ak == null && bk == null) return a.index - b.index;
  if (ak == null) return 1;
  if (bk == null) return -1;
  if (ak !== bk) return direction === 'newest' ? (bk - ak) : (ak - bk);
  return direction === 'newest' ? (b.index - a.index) : (a.index - b.index);
}

function histParseWork_(values, deps) {
  var headerIdx = histHeaderRowIndex_(values);
  if (headerIdx < 0) return { ok: false };
  var headers = values[headerIdx] || [];
  var dateCol = histFindCol_(headers, ['日付']);
  var workCol = histFindCol_(headers, ['作業内容']);
  if (dateCol < 0 || workCol < 0) {
    histLog_(deps, 'history work headers unavailable: ' + histHeaderPreview_(headers));
    return { ok: false };
  }
  var items = [];
  for (var r = headerIdx + 1; r < values.length; r++) {
    var row = values[r] || [];
    var dateVal = row[dateCol];
    var workVal = row[workCol];
    var dateText = histFormatDay_(dateVal, deps);
    var workText = histText_(workVal);
    if (!dateText && !workText) continue;
    var sortSource = (dateVal instanceof Date) ? dateVal : dateText;
    items.push({ index: r, sortKey: histSortKey_(sortSource), date: dateText, work: workText });
  }
  items.sort(function(a, b) { return histCompare_('newest', a, b); });
  return { ok: true, items: items };
}

function histTalkStamp_(row, atCol, dateCol, timeCol, deps) {
  if (atCol >= 0) {
    var atVal = row[atCol];
    if (atVal instanceof Date) return { text: histFormatDateTime_(atVal, deps), sort: histSortKey_(atVal) };
    var atText = histText_(atVal);
    return { text: atText, sort: histSortKey_(atText) };
  }
  var dateVal = row[dateCol];
  var timeVal = timeCol >= 0 ? row[timeCol] : '';
  var dateText = histFormatDay_(dateVal, deps);
  var timeText = histText_(timeVal);
  var text = dateText && timeText ? (dateText + ' ' + timeText) : (dateText || timeText);
  var sortSource = text;
  if (dateVal instanceof Date && !timeText) sortSource = dateVal;
  return { text: text, sort: histSortKey_(sortSource) };
}

function histParseTalk_(values, deps) {
  var headerIdx = histHeaderRowIndex_(values);
  if (headerIdx < 0) return { ok: false };
  var headers = values[headerIdx] || [];
  var atCol = histFindCol_(headers, ['日時', '日付時刻', 'タイムスタンプ']);
  var dateCol = -1;
  var timeCol = -1;
  if (atCol < 0) {
    dateCol = histFindCol_(headers, ['日付']);
    timeCol = histFindCol_(headers, ['時刻', '時間']);
    if (dateCol < 0) {
      histLog_(deps, 'history talk headers unavailable: ' + histHeaderPreview_(headers));
      return { ok: false };
    }
  }
  var speakerCol = histFindCol_(headers, ['送信者', '話者', '発言者', '差出人', '名前', '誰', 'ユーザー']);
  var bodyCol = histFindCol_(headers, ['本文', 'メッセージ', '発言内容', 'テキスト', '発言', '内容']);
  if (speakerCol < 0 || bodyCol < 0) {
    histLog_(deps, 'history talk headers unavailable: ' + histHeaderPreview_(headers));
    return { ok: false };
  }
  var items = [];
  for (var r = headerIdx + 1; r < values.length; r++) {
    var row = values[r] || [];
    var stamp = histTalkStamp_(row, atCol, dateCol, timeCol, deps);
    var speaker = histText_(row[speakerCol]);
    var body = histText_(row[bodyCol]);
    if (!stamp.text && !speaker && !body) continue;
    items.push({ index: r, sortKey: stamp.sort, at: stamp.text, speaker: speaker, body: body });
  }
  items.sort(function(a, b) { return histCompare_('oldest', a, b); });
  return { ok: true, items: items };
}

function histClampPage_(value) {
  var page = parseInt(value, 10);
  if (!isFinite(page) || page < 1) return 1;
  if (page > HIST_PAGE_CAP) return HIST_PAGE_CAP;
  return page;
}

function histClampPageSize_(value) {
  var size = parseInt(value, 10);
  if (!isFinite(size) || size < 1) return HIST_PAGE_DEFAULT;
  if (size > HIST_PAGE_MAX) return HIST_PAGE_MAX;
  return size;
}

function histPublicItem_(mode, item) {
  if (mode === 'talk') return { at: item.at, speaker: item.speaker, body: item.body };
  return { date: item.date, work: item.work };
}

function histPage_(mode, sorted, requestData) {
  var pageSize = histClampPageSize_(requestData && requestData.pageSize);
  var page = histClampPage_(requestData && requestData.page);
  var start = (page - 1) * pageSize;
  var slice = start >= sorted.length ? [] : sorted.slice(start, start + pageSize);
  return {
    page: page,
    pageSize: pageSize,
    total: sorted.length,
    hasMore: start + slice.length < sorted.length,
    items: slice.map(function(item) { return histPublicItem_(mode, item); })
  };
}

function histRead_(userId, requestData, deps) {
  if (!userId) return histError_('forbidden');
  var mode = String((requestData && requestData.mode) || '');
  if (mode !== 'work' && mode !== 'talk') return histError_('unavailable');

  var sheetId = '';
  try { sheetId = String(deps.sheetId() || '').trim(); } catch (e) { return histError_('unavailable'); }
  if (!sheetId) return histError_('unavailable');

  var ss = deps.openSpreadsheet(sheetId);
  var sheetName = mode === 'talk' ? '会話' : 'メンテナンス';
  var sheet = ss && ss.getSheetByName ? ss.getSheetByName(sheetName) : null;
  if (!sheet || !sheet.getDataRange) return histError_('unavailable');
  var values = sheet.getDataRange().getValues();
  if (!values || values.length > HIST_ROW_CAP) return histError_('unavailable');

  var parsed = mode === 'talk' ? histParseTalk_(values, deps) : histParseWork_(values, deps);
  if (!parsed.ok) return histError_('unavailable');
  var paged = histPage_(mode, parsed.items, requestData);
  return {
    status: 'success',
    mode: mode,
    label: HIST_LABEL,
    page: paged.page,
    pageSize: paged.pageSize,
    total: paged.total,
    hasMore: paged.hasMore,
    items: paged.items
  };
}

function histHandleGetMyHistory_(requestData, deps) {
  var auth;
  try {
    auth = histAuthorize_(requestData, deps);
  } catch (e) {
    return histError_('unauthorized');
  }
  if (!auth.ok) return auth.error;
  try {
    return histRead_(auth.userId, requestData, deps);
  } catch (e2) {
    histLog_(deps, 'history read failed');
    return histError_('unavailable');
  }
}

function handleGetMyHistory_(requestData) {
  return histHandleGetMyHistory_(requestData, histGasDeps_());
}

function histGasDeps_() {
  var liffId = (typeof ID_LIFF !== 'undefined') ? ID_LIFF : '';
  return {
    props: PropertiesService.getScriptProperties(),
    liffId: liffId,
    fetchUrl: function(url, options) { return UrlFetchApp.fetch(url, options); },
    openSpreadsheet: function(id) { return SpreadsheetApp.openById(id); },
    nowSec: function() { return Math.floor(Date.now() / 1000); },
    formatDay: function(d) { return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd'); },
    formatDateTime: function(d) { return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'); },
    sheetId: function() { return historyTrialSheetId_(); },
    log: function(message) { console.error(message); }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HIST_LABEL: HIST_LABEL,
    HIST_MSG: HIST_MSG,
    HIST_VERIFY_URL: HIST_VERIFY_URL,
    HIST_PAGE_DEFAULT: HIST_PAGE_DEFAULT,
    HIST_PAGE_MAX: HIST_PAGE_MAX,
    histHandleGetMyHistory_: histHandleGetMyHistory_,
    histAuthorize_: histAuthorize_
  };
}
