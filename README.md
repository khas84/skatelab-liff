# SkateLab LIFF（GitHub Pages）

Android で GAS 配信 HTML の `liff.init` が止まる問題を避けるため、お客様向け画面は GitHub Pages で配信します。GAS は API / LINE Webhook / 管理画面専用です（doGet は顧客 UI を返しません）。

## URL

- Pages（予約）: https://khas84.github.io/skatelab-liff/
- 宅急便モード: https://khas84.github.io/skatelab-liff/?mode=takkyubin

## LINE Developers 設定

LIFF Endpoint URL はすでに `https://khas84.github.io/skatelab-liff/` です。

1. LIFF アプリの Endpoint URL を `https://khas84.github.io/skatelab-liff/` にする
2. リッチメニューの宅急便は `https://khas84.github.io/skatelab-liff/?mode=takkyubin` を使う

## 設定ファイル

公開してよい ID / URL のみ `config.js` に置きます（トークンは置かない）。

- `LIFF_ID`
- `GAS_API_URL`（GAS Web アプリの `/exec`）

`index.html` は `config.js` を読み込み、これらの値で LIFF 初期化と API 呼び出しを行います。

## GAS

Web アプリの `/exec` に JSON POST（`Content-Type: text/plain`）で次の action を送ります。`text/plain` は Apps Script の CORS 制約を避けるための指定です。

- `submit_reservation`
- `get_busy_travel_dates`
- `submit_takkyubin`
- `get_takkyubin_address`
