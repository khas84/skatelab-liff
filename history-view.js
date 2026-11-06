// History viewer presentation. Renders text only (escaped). No tokens, no sheet ids.
var HISTORY_PAGE_SIZE = 20;

var HISTORY_MESSAGES = {
  loading: '読み込み中です…',
  empty: '表示できる履歴はまだありません。',
  expired: '認証の有効期限が切れました。LINEアプリから開き直してください。',
  unauthorized: '認証の有効期限が切れているか、LINEアプリから開き直してください。',
  forbidden: 'この履歴を表示する権限がありません。',
  unavailable: '履歴を読み込めませんでした。しばらくしてからもう一度お試しください。',
  network: '通信エラーが発生しました。もう一度お試しください。',
  blankPage: 'このページには履歴がありません。'
};

var DEMO_WORK = [
  { date: '2026/04/02', work: '（架空）エッジを研磨した' },
  { date: '2026/03/18', work: '（架空）刃のバリを取った\n左足のみ\n<script>alert(1)</script>' },
  { date: '2026/01/09', work: '（架空）季節前の確認' }
];

var DEMO_TALK = [
  { at: '2026/01/09 11:02', speaker: '架空のお客様', body: 'こんにちは\n明日はお願いします' },
  { at: '2026/01/09 11:05', speaker: '架空の店舗', body: '承知しました。\n<script>は文字として出ます' },
  { at: '2026/03/18 16:40', speaker: '架空のお客様', body: '仕上がりを確認しました' }
];

function escapeHistoryText(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function historyPlain_(value) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function allowLocalFixture(hostname, flag) {
  if (flag !== 'demo') return false;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function historyModeHref(pathname, mode, hostname, fixtureFlag) {
  var extra = allowLocalFixture(hostname, fixtureFlag) ? '&fixture=demo' : '';
  return String(pathname || '') + '?mode=' + mode + extra;
}

function historyApiMode(pageMode) {
  return pageMode === 'history_talk' || pageMode === 'talk' ? 'talk' : 'work';
}

// idToken stays in the JSON body. userId from the page is never sent.
function buildHistoryRequest(opts) {
  opts = opts || {};
  var page = parseInt(opts.page, 10);
  if (!isFinite(page) || page < 1) page = 1;
  var body = {
    action: 'get_my_history',
    mode: historyApiMode(opts.mode),
    page: page,
    pageSize: HISTORY_PAGE_SIZE
  };
  if (opts.idToken) body.idToken = String(opts.idToken);
  return body;
}

function buildAdminHistoryReplySuffix(liffId) {
  var id = String(liffId || '').replace(/[^0-9A-Za-z-]/g, '');
  if (!id) return '';
  var workUrl = 'https://liff.line.me/' + id + '?mode=history_work';
  var talkUrl = 'https://liff.line.me/' + id + '?mode=history_talk';
  return '\n\n【試験用・吉田さんサンプル】\n'
    + '過去の作業履歴\n' + workUrl + '\n'
    + '過去の会話履歴\n' + talkUrl;
}

function renderHistoryItems(mode, items) {
  return (items || []).map(function(item) {
    var safe = item || {};
    if (mode === 'talk') {
      var speaker = historyPlain_(safe.speaker).trim() || '（話者不明）';
      return '<article class="history-card history-talk">'
        + '<p class="history-meta"><time>' + escapeHistoryText(historyPlain_(safe.at).trim()) + '</time>'
        + '　<span class="history-speaker">' + escapeHistoryText(speaker) + '</span></p>'
        + '<p class="history-body">' + escapeHistoryText(historyPlain_(safe.body).trim()) + '</p>'
        + '</article>';
    }
    return '<article class="history-card history-work">'
      + '<p class="history-meta"><time>' + escapeHistoryText(historyPlain_(safe.date).trim()) + '</time></p>'
      + '<p class="history-body">' + escapeHistoryText(historyPlain_(safe.work).trim()) + '</p>'
      + '</article>';
  }).join('');
}

function describeHistoryView(state) {
  if (!state || state.phase === 'loading') {
    return {
      banner: '',
      statusText: HISTORY_MESSAGES.loading,
      statusClass: 'loading',
      listHtml: '',
      showPager: false,
      pagerLabel: '',
      prevDisabled: true,
      nextDisabled: true
    };
  }
  if (state.phase !== 'ready') {
    var code = state && state.code;
    if (!HISTORY_MESSAGES[code] || code === 'loading' || code === 'empty' || code === 'blankPage') code = 'unavailable';
    return {
      banner: '',
      statusText: HISTORY_MESSAGES[code],
      statusClass: 'error',
      listHtml: '',
      showPager: false,
      pagerLabel: '',
      prevDisabled: true,
      nextDisabled: true
    };
  }
  var items = Array.isArray(state.items) ? state.items : [];
  var total = Number(state.total);
  if (!isFinite(total) || total < items.length) total = items.length;
  var pageSize = parseInt(state.pageSize, 10);
  if (!isFinite(pageSize) || pageSize < 1) pageSize = HISTORY_PAGE_SIZE;
  var page = parseInt(state.page, 10);
  if (!isFinite(page) || page < 1) page = 1;
  var banner = historyPlain_(state.label).trim();
  if (!items.length) {
    return {
      banner: banner,
      statusText: total > 0 ? HISTORY_MESSAGES.blankPage : HISTORY_MESSAGES.empty,
      statusClass: 'empty',
      listHtml: '',
      showPager: total > pageSize,
      pagerLabel: total > pageSize ? ('全' + total + '件') : '',
      prevDisabled: page <= 1,
      nextDisabled: true
    };
  }
  var from = (page - 1) * pageSize + 1;
  var to = from + items.length - 1;
  return {
    banner: banner,
    statusText: '',
    statusClass: '',
    listHtml: renderHistoryItems(state.mode, items),
    showPager: total > pageSize,
    pagerLabel: from + '〜' + to + '件 / 全' + total + '件',
    prevDisabled: page <= 1,
    nextDisabled: to >= total
  };
}

function demoHistoryState(pageMode, page) {
  var mode = historyApiMode(pageMode);
  var all = mode === 'talk' ? DEMO_TALK : DEMO_WORK;
  var pageSize = 2;
  var p = parseInt(page, 10);
  if (!isFinite(p) || p < 1) p = 1;
  var start = (p - 1) * pageSize;
  var items = all.slice(start, start + pageSize);
  return {
    phase: 'ready',
    mode: mode,
    label: '試験用・吉田さんサンプル',
    page: p,
    pageSize: pageSize,
    total: all.length,
    hasMore: start + items.length < all.length,
    items: items
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HISTORY_PAGE_SIZE: HISTORY_PAGE_SIZE,
    HISTORY_MESSAGES: HISTORY_MESSAGES,
    escapeHistoryText: escapeHistoryText,
    allowLocalFixture: allowLocalFixture,
    historyModeHref: historyModeHref,
    historyApiMode: historyApiMode,
    buildHistoryRequest: buildHistoryRequest,
    buildAdminHistoryReplySuffix: buildAdminHistoryReplySuffix,
    renderHistoryItems: renderHistoryItems,
    describeHistoryView: describeHistoryView,
    demoHistoryState: demoHistoryState
  };
}
