# SkateLab LIFF（GitHub Pages）

Android で GAS 配信 HTML の `liff.init` が止まる問題を避けるため、お客様向け画面は GitHub Pages で配信します。GAS は API / LINE Webhook / 管理画面専用です（doGet は顧客 UI を返しません）。

## URL

クエリ `mode` で画面を切り替えます。日付の基準は Asia/Tokyo です。

- `mode=sameday` → 当日予約（日付は本日固定、第1候補のみ。送信 JSON に `mode: "sameday"`）
- `mode=calendar` または未指定 / その他（`takkyubin` 以外）→ カレンダー予約（最短は翌日。第1〜第3候補。送信 JSON に `mode: "calendar"`）
- `mode=takkyubin` → 宅急便発送（従来どおり）
- `mode=history_work` → 過去の作業履歴（LINEログイン必須。試験中は管理者だけ）
- `mode=history_talk` → 過去の会話履歴（同じ）

Pages:

- 当日予約: https://khas84.github.io/skatelab-liff/?mode=sameday
- カレンダー予約: https://khas84.github.io/skatelab-liff/?mode=calendar
- 宅急便: https://khas84.github.io/skatelab-liff/?mode=takkyubin
- 作業履歴: https://khas84.github.io/skatelab-liff/?mode=history_work
- 会話履歴: https://khas84.github.io/skatelab-liff/?mode=history_talk

LIFF（`<LIFF_ID>` は `config.js` の値）:

- https://liff.line.me/<LIFF_ID>?mode=sameday
- https://liff.line.me/<LIFF_ID>?mode=calendar
- https://liff.line.me/<LIFF_ID>?mode=takkyubin
- https://liff.line.me/<LIFF_ID>?mode=history_work
- https://liff.line.me/<LIFF_ID>?mode=history_talk

## LINE Developers 設定

LIFF Endpoint URL はすでに `https://khas84.github.io/skatelab-liff/` です。

1. LIFF アプリの Endpoint URL を `https://khas84.github.io/skatelab-liff/` にする
2. リッチメニューの当日予約は `https://khas84.github.io/skatelab-liff/?mode=sameday` を使う
3. リッチメニューのカレンダー予約は `https://khas84.github.io/skatelab-liff/?mode=calendar` を使う（未指定もカレンダー）
4. リッチメニューの宅急便は `https://khas84.github.io/skatelab-liff/?mode=takkyubin` を使う

## 設定ファイル

公開してよい ID / URL のみ `config.js` に置きます（トークンは置かない）。

- `LIFF_ID`
- `GAS_API_URL`（GAS Web アプリの `/exec`）

`index.html` は `config.js` を読み込み、これらの値で LIFF 初期化と API 呼び出しを行います。

## GAS

Web アプリの `/exec` に JSON POST（`Content-Type: text/plain`）で次の action を送ります。`text/plain` は Apps Script の CORS 制約を避けるための指定です。

- `submit_reservation`（予約。`user` / `candidates` / `menus` に加え `mode` が `"sameday"` または `"calendar"`）
- `get_busy_travel_dates`
- `submit_takkyubin`
- `get_takkyubin_address`
- `get_my_history`（`mode` は `work` または `talk`、`page`、`pageSize`、`idToken`。ユーザーIDは送りません。トークンは URL に付けません）

履歴画面は LIFF の ID トークンをサーバが検証したあとだけ表示します。試験中の中身は管理者だけです。

テスト: `node --test`
