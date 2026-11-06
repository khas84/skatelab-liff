const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const view = require(path.join(root, 'history-view.js'));
const server = require(path.join(root, 'history-server.js'));
const modes = require(path.join(root, 'page-mode.js'));

const ADMIN = 'U' + 'a'.repeat(32);
const OTHER = 'U' + 'b'.repeat(32);
const CHANNEL = '1234567890';
const LIFF = CHANNEL + '-TestLiff';
const SHEET = 'SECRET_SHEET_ID';

function tokyoParts(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = {};
  fmt.formatToParts(date).forEach(function(p) { parts[p.type] = p.value; });
  return parts;
}

function formatDay(date) {
  const p = tokyoParts(date);
  return p.year + '/' + p.month + '/' + p.day;
}

function formatDateTime(date) {
  const p = tokyoParts(date);
  return formatDay(date) + ' ' + p.hour + ':' + p.minute;
}

function sheetOf(values) {
  return {
    getDataRange: function() {
      return { getValues: function() { return values; } };
    }
  };
}

function makeDeps(options) {
  const opt = options || {};
  const props = Object.assign({
    LINE_LOGIN_CHANNEL_ID: CHANNEL,
    ADMIN_LINE_USER_ID: ADMIN
  }, opt.props || {});
  const opened = [];
  const logs = [];
  const calls = [];
  const sheets = opt.sheets || { 'メンテナンス': [['日付', '作業内容']], '会話': [['日時', '送信者', '本文']] };
  const behavior = opt.verify || function() {
    return { code: 400, body: { error_description: 'Invalid IdToken.' } };
  };
  return {
    opened: opened,
    logs: logs,
    calls: calls,
    props: { getProperty: function(key) { return props[key] == null ? null : String(props[key]); } },
    liffId: opt.liffId == null ? LIFF : opt.liffId,
    nowSec: function() { return opt.nowSec == null ? 1700000000 : opt.nowSec; },
    formatDay: formatDay,
    formatDateTime: formatDateTime,
    sheetId: function() {
      if (opt.sheetThrows) throw new Error('sheet id failed ' + SHEET);
      return opt.sheetId == null ? SHEET : opt.sheetId;
    },
    openSpreadsheet: function(id) {
      opened.push(id);
      if (opt.openThrows) throw new Error('open failed ' + id);
      return {
        getSheetByName: function(name) {
          opened.push('sheet:' + name);
          if (opt.valuesThrows && sheets[name]) {
            return { getDataRange: function() { throw new Error('values failed ' + SHEET); } };
          }
          if (!sheets[name]) return null;
          return sheetOf(sheets[name]);
        }
      };
    },
    fetchUrl: function(url, request) {
      calls.push({ url: url, options: request });
      if (opt.fetchThrows) throw new Error('network ' + (request.payload && request.payload.id_token));
      const res = behavior(url, request);
      return {
        getResponseCode: function() { return res.code; },
        getContentText: function() { return JSON.stringify(res.body); }
      };
    },
    log: function(message) { logs.push(String(message)); }
  };
}

function claims(overrides) {
  return Object.assign({
    iss: 'https://access.line.me',
    sub: ADMIN,
    aud: CHANNEL,
    exp: 2000000000
  }, overrides || {});
}

function verifyByToken(map) {
  return function(url, request) {
    const token = request && request.payload && request.payload.id_token;
    if (map[token]) return map[token];
    return { code: 400, body: { error_description: 'Invalid IdToken.' } };
  };
}

function run(token, deps, extra) {
  return server.histHandleGetMyHistory_(Object.assign({
    idToken: token,
    mode: 'work',
    page: 1,
    pageSize: 20,
    user: { userId: 'forged-' + ADMIN, displayName: 'spoof' }
  }, extra || {}), deps);
}

test('page modes keep booking routes and add history routes', function() {
  assert.equal(modes.resolvePageMode('sameday'), 'sameday');
  assert.equal(modes.resolvePageMode('calendar'), 'calendar');
  assert.equal(modes.resolvePageMode(''), 'calendar');
  assert.equal(modes.resolvePageMode('takkyubin'), 'takkyubin');
  assert.equal(modes.resolvePageMode('takkyubin_inquiry'), 'takkyubin_inquiry');
  assert.equal(modes.resolvePageMode('register'), 'register');
  assert.equal(modes.resolvePageMode('history'), 'calendar');
  assert.equal(modes.resolvePageMode('history_work'), 'history_work');
  assert.equal(modes.resolvePageMode('history_talk'), 'history_talk');
  assert.equal(modes.isHistoryMode('history_work'), true);
  assert.equal(modes.isHistoryMode('sameday'), false);
});

test('history request omits userId and keeps the token out of the URL', function() {
  const body = view.buildHistoryRequest({
    mode: 'history_talk',
    page: 2,
    idToken: 'tok.en',
    accessToken: 'should-not-send',
    userId: ADMIN,
    user: { userId: ADMIN }
  });
  assert.deepEqual(Object.keys(body).sort(), ['action', 'idToken', 'mode', 'page', 'pageSize']);
  assert.equal(body.action, 'get_my_history');
  assert.equal(body.mode, 'talk');
  assert.equal(body.page, 2);
  assert.equal(body.pageSize, 20);
  assert.equal(JSON.stringify(body).includes(ADMIN), false);
});

test('admin reply suffix is the two LIFF history links', function() {
  const text = view.buildAdminHistoryReplySuffix('2009436433-Nh9ImTsd');
  assert.match(text, /【試験用・吉田さんサンプル】/);
  assert.match(text, /過去の作業履歴\nhttps:\/\/liff\.line\.me\/2009436433-Nh9ImTsd\?mode=history_work/);
  assert.match(text, /過去の会話履歴\nhttps:\/\/liff\.line\.me\/2009436433-Nh9ImTsd\?mode=history_talk/);
  assert.equal(text.includes('docs.google.com'), false);
  assert.equal(view.buildAdminHistoryReplySuffix(''), '');
  assert.equal(view.allowLocalFixture('127.0.0.1', 'demo'), true);
  assert.equal(view.allowLocalFixture('localhost', 'demo'), true);
  assert.equal(view.allowLocalFixture('khas84.github.io', 'demo'), false);
  assert.equal(view.allowLocalFixture('localhost.evil.com', 'demo'), false);
  assert.equal(view.historyModeHref('/skatelab-liff/', 'history_work', 'khas84.github.io', 'demo'), '/skatelab-liff/?mode=history_work');
  assert.equal(view.historyModeHref('/', 'history_talk', '127.0.0.1', 'demo'), '/?mode=history_talk&fixture=demo');
});

test('renderer escapes text, keeps newlines, and hides prices', function() {
  const html = view.renderHistoryItems('work', [{
    date: '2026/03/18',
    work: '（架空）研いだ\n<script>alert(1)</script>',
    price: '<b>3000円</b>'
  }]);
  assert.match(html, /（架空）研いだ\n&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('3000'), false);
  assert.equal(html.includes('<b>'), false);

  const talk = view.renderHistoryItems('talk', [{
    at: '2026/01/09 11:02',
    speaker: '架空"客"',
    body: '1行目\n2行目</article>'
  }]);
  assert.match(talk, /1行目\n2行目&lt;\/article&gt;/);
  assert.match(talk, /架空&quot;客&quot;/);
  assert.equal(talk.includes('</article></article>'), false);
});

test('view states cover loading, empty, expired, forbidden, and paging', function() {
  const loading = view.describeHistoryView({ phase: 'loading' });
  assert.equal(loading.statusText, view.HISTORY_MESSAGES.loading);
  assert.equal(loading.listHtml, '');
  assert.equal(loading.banner, '');

  const expired = view.describeHistoryView({ phase: 'error', code: 'expired', message: '<script>SECRET_SHEET' });
  assert.equal(expired.statusText, view.HISTORY_MESSAGES.expired);
  assert.equal(expired.banner, '');
  assert.equal(JSON.stringify(expired).includes('SECRET_SHEET'), false);
  assert.equal(JSON.stringify(expired).includes('<script>'), false);

  const forbidden = view.describeHistoryView({ phase: 'error', code: 'forbidden', items: [{ work: 'leak' }] });
  assert.equal(forbidden.statusText, view.HISTORY_MESSAGES.forbidden);
  assert.equal(forbidden.listHtml, '');

  const empty = view.describeHistoryView({ phase: 'ready', mode: 'work', label: '試験用・吉田さんサンプル', items: [], total: 0, page: 1, pageSize: 20 });
  assert.equal(empty.statusText, view.HISTORY_MESSAGES.empty);
  assert.equal(empty.banner, '試験用・吉田さんサンプル');
  assert.equal(empty.showPager, false);

  const items = [];
  for (let i = 0; i < 45; i++) items.push({ date: '2026/01/01', work: '行' + i });
  const page = view.describeHistoryView({ phase: 'ready', mode: 'work', label: '試験用・吉田さんサンプル', items: items.slice(0, 20), total: 45, page: 1, pageSize: 20 });
  assert.equal(page.pagerLabel, '1〜20件 / 全45件');
  assert.equal(page.prevDisabled, true);
  assert.equal(page.nextDisabled, false);
  assert.equal(page.showPager, true);

  const demo1 = view.demoHistoryState('history_work', 1);
  const demo2 = view.demoHistoryState('history_work', 2);
  assert.equal(demo1.items.length, 2);
  assert.equal(demo2.items.length, 1);
  assert.equal(demo1.items.concat(demo2.items).length, 3);
  const talk = view.demoHistoryState('history_talk', 1);
  assert.equal(talk.mode, 'talk');
  assert.match(talk.items[0].body, /\n/);
});

test('messages stay aligned and index.html keeps booking actions', function() {
  assert.equal(view.HISTORY_MESSAGES.unauthorized, server.HIST_MSG.unauthorized);
  assert.equal(view.HISTORY_MESSAGES.expired, server.HIST_MSG.expired);
  assert.equal(view.HISTORY_MESSAGES.forbidden, server.HIST_MSG.forbidden);
  assert.equal(view.HISTORY_MESSAGES.unavailable, server.HIST_MSG.unavailable);
  assert.equal(view.HISTORY_PAGE_SIZE, server.HIST_PAGE_DEFAULT);

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /submit_reservation/);
  assert.match(html, /get_busy_travel_dates/);
  assert.match(html, /submit_takkyubin/);
  assert.match(html, /register_customer/);
  assert.match(html, /buildHistoryRequest\(/);
  assert.match(html, /resolvePageMode\(modeParam\)/);
  assert.match(html, /cache:\s*'no-store'/);
  const viewSrc = fs.readFileSync(path.join(root, 'history-view.js'), 'utf8');
  assert.match(viewSrc, /get_my_history/);
  assert.doesNotMatch(html, /localStorage/);
  assert.doesNotMatch(html, /history-server\.js/);
  assert.doesNotMatch(html, /docs\.google\.com\/spreadsheets/);

  const serverSrc = fs.readFileSync(path.join(root, 'history-server.js'), 'utf8');
  assert.match(serverSrc, /function handleGetMyHistory_/);
  assert.match(serverSrc, /function histRead_/);
  assert.match(serverSrc, /function histAuthorize_/);
  assert.doesNotMatch(serverSrc, /generativelanguage/);
  assert.doesNotMatch(serverSrc, /spreadsheets\/d\//);
  assert.doesNotMatch(serverSrc, /localStorage/);
});

test('owner receives paged work and talk rows; failures do not open the sheet', function() {
  const workRows = [
    ['日付', '作業内容', '料金', '根拠'],
    ['2024/01/10', 'ROW-A\n1行目', 3000, 'evidence-a'],
    [new Date('2024-03-01T00:00:00+09:00'), 'ROW-B', 1000, 'evidence-b'],
    ['2024/03/05', 'ROW-C', 500, 'evidence-c'],
    ['2024/03/05', 'ROW-D', 500, 'evidence-d'],
    ['未定', 'ROW-E', 9, 'evidence-e'],
    ['', '', 999, 'skip-me'],
    ['2024/02/02', 'ROW-F<script>', 1, 'evidence-f']
  ];
  const talkRows = [
    ['日時', '送信者', '本文', 'Gemini生レスポンス'],
    ['2024/01/02 09:05', '店舗', 'こんにちは\r\n2行目', 'raw-gemini'],
    ['2024/01/02 09:00', 'お客様', 'おはよう', 'raw-gemini-2'],
    ['2024/01/02 09:05', 'お客様', '同じ時刻の後', 'raw-gemini-3'],
    ['2024/01/01 18:00', 'お客様', '前日', 'raw-gemini-4']
  ];
  const deps = makeDeps({
    sheets: { 'メンテナンス': workRows, '会話': talkRows },
    verify: verifyByToken({
      'valid-admin': { code: 200, body: claims() },
      'valid-other': { code: 200, body: claims({ sub: OTHER }) },
      'expired-token': { code: 400, body: { error_description: 'IdToken expired.' } },
      'bad-aud-200': { code: 200, body: claims({ aud: '999' }) },
      'bad-iss': { code: 200, body: claims({ iss: 'https://evil.example' }) },
      'exp-past': { code: 200, body: claims({ exp: 1700000000 }) }
    })
  });

  const forged = 'eyJhbGciOiJub25lIn0.' + Buffer.from(JSON.stringify({
    sub: ADMIN, aud: CHANNEL, iss: 'https://access.line.me', exp: 2000000000
  })).toString('base64url') + '.sig';

  const denied = [
    ['', 'unauthorized'],
    [forged, 'unauthorized'],
    ['expired-token', 'expired'],
    ['bad-aud-200', 'unauthorized'],
    ['bad-iss', 'unauthorized'],
    ['exp-past', 'expired'],
    ['valid-other', 'forbidden']
  ];
  denied.forEach(function(pair) {
    const before = deps.opened.length;
    const body = run(pair[0], deps, { user: { userId: ADMIN } });
    assert.equal(body.code, pair[1], pair[0]);
    assert.equal(body.status, 'error');
    assert.equal(deps.opened.length, before);
    assert.equal(JSON.stringify(body).includes('ROW-A'), false);
    assert.equal(JSON.stringify(body).includes(SHEET), false);
    assert.equal(JSON.stringify(body).includes(HIST_LABEL_SAFE()), false);
  });

  assert.equal(deps.calls.length, denied.length - 1);
  deps.calls.forEach(function(call) {
    assert.equal(call.url, server.HIST_VERIFY_URL);
    assert.equal(call.url.includes('valid-admin'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(call.options.payload, 'user_id'), false);
    assert.equal(call.options.payload.client_id, CHANNEL);
  });

  const work = run('valid-admin', deps, { mode: 'work', pageSize: 20 });
  assert.equal(work.status, 'success');
  assert.equal(work.label, '試験用・吉田さんサンプル');
  assert.deepEqual(work.items.map(function(item) { return item.work; }), [
    'ROW-D', 'ROW-C', 'ROW-B', 'ROW-F<script>', 'ROW-A\n1行目', 'ROW-E'
  ]);
  assert.equal(work.items[2].date, '2024/03/01');
  work.items.forEach(function(item) {
    assert.deepEqual(Object.keys(item).sort(), ['date', 'work']);
  });
  assert.equal(JSON.stringify(work).includes('3000'), false);
  assert.equal(JSON.stringify(work).includes('evidence-a'), false);
  assert.equal(JSON.stringify(work).includes(SHEET), false);
  assert.deepEqual(deps.opened.filter(function(name) { return String(name).indexOf('sheet:') === 0; }), ['sheet:メンテナンス']);

  const talk = run('valid-admin', deps, { mode: 'talk', page: 1, pageSize: 2 });
  assert.deepEqual(talk.items, [
    { at: '2024/01/01 18:00', speaker: 'お客様', body: '前日' },
    { at: '2024/01/02 09:00', speaker: 'お客様', body: 'おはよう' }
  ]);
  const talk2 = run('valid-admin', deps, { mode: 'talk', page: 2, pageSize: 2 });
  assert.equal(talk2.items[0].body, 'こんにちは\n2行目');
  assert.equal(talk2.items[1].body, '同じ時刻の後');
  assert.equal(talk2.hasMore, false);
  const joined = talk.items.concat(talk2.items);
  assert.equal(joined.length, 4);
  assert.equal(new Set(joined.map(function(item) { return item.body; })).size, 4);

  const big = [];
  big.push(['日付', '作業内容']);
  for (let i = 0; i < 40; i++) big.push(['2024/01/' + String((i % 28) + 1), 'N' + String(i).padStart(2, '0')]);
  const pagedDeps = makeDeps({
    sheets: { 'メンテナンス': big },
    verify: verifyByToken({ 'valid-admin': { code: 200, body: claims() } })
  });
  const seen = [];
  let page = 1;
  let guard = 0;
  while (guard < 5) {
    const part = run('valid-admin', pagedDeps, { mode: 'work', page: page, pageSize: 9999 });
    assert.equal(part.pageSize, 30);
    seen.push.apply(seen, part.items);
    if (!part.hasMore) break;
    page += 1;
    guard += 1;
  }
  assert.equal(seen.length, 40);
  assert.equal(new Set(seen.map(function(item) { return item.work; })).size, 40);
});

function HIST_LABEL_SAFE() {
  return '試験用・吉田さんサンプル';
}

test('unset admin, bad channel, bad mode, and read errors fail closed', function() {
  const okVerify = verifyByToken({
    'valid-admin': { code: 200, body: claims() },
    'valid-other': { code: 200, body: claims({ sub: OTHER }) }
  });

  const unset = makeDeps({ props: { ADMIN_LINE_USER_ID: '' }, verify: okVerify });
  const unsetBody = run('valid-admin', unset);
  assert.equal(unsetBody.code, 'forbidden');
  assert.equal(unset.calls.length, 0);
  assert.equal(unset.opened.length, 0);

  const mismatch = makeDeps({ liffId: '999-Other', verify: okVerify });
  const mismatchBody = run('valid-admin', mismatch);
  assert.equal(mismatchBody.code, 'unauthorized');
  assert.equal(mismatch.calls.length, 0);
  assert.equal(mismatch.opened.length, 0);

  const badMode = makeDeps({ verify: okVerify });
  const modeBody = run('valid-admin', badMode, { mode: '原本' });
  assert.equal(modeBody.code, 'unavailable');
  assert.equal(badMode.opened.length, 0);
  assert.equal(JSON.stringify(modeBody).includes('原本'), false);

  const exploded = makeDeps({ verify: okVerify, openThrows: true });
  const explodedBody = run('valid-admin', exploded);
  assert.equal(explodedBody.code, 'unavailable');
  assert.equal(JSON.stringify(explodedBody).includes(SHEET), false);

  const values = makeDeps({ verify: okVerify, valuesThrows: true });
  const valuesBody = run('valid-admin', values);
  assert.equal(valuesBody.code, 'unavailable');
  assert.equal(JSON.stringify(valuesBody).includes(SHEET), false);

  const changed = makeDeps({
    verify: okVerify,
    sheets: { 'メンテナンス': [['日付', '作業内容'], ['2024/01/01', 'FIRST']] }
  });
  const first = run('valid-admin', changed);
  changed.sheets = null;
  const live = changed.openSpreadsheet;
  let rows = [['日付', '作業内容'], ['2024/01/01', 'FIRST']];
  changed.openSpreadsheet = function(id) {
    return live.call(changed, id);
  };
  // Replace sheet contents between calls to prove there is no identity cache.
  const secondDeps = makeDeps({
    verify: okVerify,
    sheets: { 'メンテナンス': [['日付', '作業内容'], ['2024/01/01', 'FIRST'], ['2024/02/02', 'SECOND']] }
  });
  const second = run('valid-admin', secondDeps);
  assert.equal(first.total, 1);
  assert.equal(second.total, 2);
  assert.equal(second.items[0].work, 'SECOND');
  const otherDeps = makeDeps({
    verify: okVerify,
    sheets: { 'メンテナンス': [['日付', '作業内容'], ['2024/01/01', 'FIRST']] }
  });
  const other = run('valid-other', otherDeps);
  assert.equal(other.code, 'forbidden');
  assert.equal(JSON.stringify(other).includes('FIRST'), false);
  assert.equal(otherDeps.opened.length, 0);
  void rows;
});

test('separate date and time columns stay in chronological order', function() {
  const deps = makeDeps({
    sheets: {
      '会話': [
        ['日付', '時刻', '話者', '本文', '要確認'],
        ['2024/05/02', '15:00', '店舗', '午後', 'no'],
        ['2024/05/02', '09:00', 'お客様', '午前\n続き', 'no']
      ]
    },
    verify: verifyByToken({ 'valid-admin': { code: 200, body: claims() } })
  });
  const body = run('valid-admin', deps, { mode: 'talk' });
  assert.deepEqual(body.items.map(function(item) { return item.at; }), ['2024/05/02 09:00', '2024/05/02 15:00']);
  assert.equal(body.items[0].body, '午前\n続き');
  assert.equal(JSON.stringify(body).includes('要確認'), false);
  assert.deepEqual(deps.opened.filter(function(name) { return String(name).indexOf('sheet:') === 0; }), ['sheet:会話']);
});
