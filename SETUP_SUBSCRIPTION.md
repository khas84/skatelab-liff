# サブスクリプション機能 セットアップガイド

## 収益シミュレーション

| 加入人数 | 平均単価 | 月収 | 日割り |
|---------|---------|------|------|
| 10名 | ¥4,500 | ¥45,000 | ¥1,500 |
| 20名 | ¥4,500 | ¥90,000 | ¥3,000 |
| 30名 | ¥4,500 | ¥135,000 | **¥4,500** |
| 40名 | ¥4,500 | ¥180,000 | **¥6,000** |

既存の LIFF 予約ユーザーに案内するだけで現実的に達成可能な数字です。

---

## 必要なセットアップ（約2〜3時間）

### Step 1: Stripe アカウント作成
1. https://stripe.com/jp にアクセスしてアカウント作成
2. 本人確認書類（免許証など）をアップロード
3. 銀行口座を登録（売上の自動振込先）

### Step 2: Stripe で定期課金プランを作成
Stripe ダッシュボード > 製品 > 新規作成

| プラン名 | 価格 | 請求間隔 | メモに記入するPRICE_ID |
|---------|------|---------|-------------------|
| SkateLab ベーシック | ¥2,000 | 毎月 | → `subscription.html` の `price_BASIC_PLAN_ID_HERE` に入力 |
| SkateLab スタンダード | ¥4,500 | 毎月 | → `price_STANDARD_PLAN_ID_HERE` に入力 |
| SkateLab プレミアム | ¥9,800 | 毎月 | → `price_PREMIUM_PLAN_ID_HERE` に入力 |

### Step 3: subscription.html を更新
```javascript
// subscription.html の以下の箇所を実際の値に変更
const STRIPE_PUBLIC_KEY = "pk_live_YOUR_STRIPE_PUBLIC_KEY_HERE";
// ↑ Stripeダッシュボード > 開発者 > APIキー > 公開可能キー

const PLANS = {
    basic:    { ..., stripePriceId: "price_xxxxxx" },  // Step2で作成したID
    standard: { ..., stripePriceId: "price_yyyyyy" },
    premium:  { ..., stripePriceId: "price_zzzzzz" },
};
```

### Step 4: GAS（Google Apps Script）の設定
1. 既存の GAS プロジェクトを開く（予約システムと同じもの）
2. `subscription_backend.gs` の内容を貼り付ける
3. プロジェクトプロパティ > スクリプトプロパティに追加:

| キー | 値 |
|-----|---|
| `STRIPE_SECRET_KEY` | sk_live_xxxxx（Stripeのシークレットキー） |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API のトークン |
| `OWNER_LINE_USER_ID` | あなた自身のLINE User ID |

4. デプロイを更新（既存のWebアプリURLはそのまま使える）

### Step 5: Stripe Webhook 設定
1. Stripeダッシュボード > 開発者 > Webhook > エンドポイントを追加
2. URL: GASのWebアプリURL（既存の予約システムと同じURL）
3. 監視するイベント:
   - `checkout.session.completed`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`

### Step 6: 月次サマリーのトリガー設定（オプション）
GAS エディタ > トリガー > 新規追加
- 実行する関数: `monthlySubscriptionSummary`
- イベントのソース: 時間主導型 > 月タイマー > 毎月1日

---

## LINE での告知文（コピペ用）

```
⛸️【SkateLab メンバーシップ開始】

毎月のメンテをもっとお得に！

✅ ベーシックプラン ¥2,000/月
　　研磨10%OFF + 優先予約

⭐ スタンダードプラン ¥4,500/月  ← 人気！
　　研磨1回無料 + 全メニュー15%OFF

👑 プレミアムプラン ¥9,800/月
　　月2回無料メンテ + 相談し放題

▶ 申込はこちら: [LIFFのURL]

いつでも解約OK・初月日割り計算
```

---

## ファイル構成

```
skatelab-liff/
├── index.html              # 既存の予約システム（変更なし）
├── subscription.html       # 新規: 月額プラン申込ページ
├── subscription-success.html # 新規: 決済完了ページ
└── gas/
    └── subscription_backend.gs  # 新規: GASバックエンドコード
```
