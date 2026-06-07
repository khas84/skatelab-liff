/**
 * SkateLab サブスクリプション管理 - Google Apps Script バックエンド
 *
 * セットアップ手順:
 * 1. Google スプレッドシートを開き、ツール > スクリプトエディタ
 * 2. このコードを既存の doPost に追加（または新しいGASプロジェクトとして作成）
 * 3. プロジェクトのプロパティ > スクリプトプロパティに以下を設定:
 *    - STRIPE_SECRET_KEY: sk_live_xxxxx
 *    - STRIPE_WEBHOOK_SECRET: whsec_xxxxx
 *    - LINE_CHANNEL_ACCESS_TOKEN: LINE Messaging API のトークン
 *    - SUBSCRIPTION_SHEET_ID: スプレッドシートID（URLのd/xxxxx/editのxxxxxの部分）
 * 4. デプロイ > 新しいデプロイ > ウェブアプリとして公開（全員がアクセス可能）
 */

const PROPS = PropertiesService.getScriptProperties();

function doPost(e) {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    if (action === "create_subscription_checkout") {
        return createStripeCheckout(data);
    }
    if (action === "stripe_webhook") {
        return handleStripeWebhook(data);
    }
    if (action === "submit_reservation") {
        return handleReservation(data); // 既存の予約処理
    }

    return jsonResponse({ status: "error", message: "unknown action" });
}

// ── Stripe Checkout セッション作成 ────────────────────────────────────────────
function createStripeCheckout(data) {
    const stripeKey = PROPS.getProperty("STRIPE_SECRET_KEY");
    const successUrl = "https://skatelab.jp/subscription-success?session_id={CHECKOUT_SESSION_ID}";
    const cancelUrl  = "https://line.me/R/oaMessage/@skatelab"; // LINE公式アカウントに戻す

    const payload = [
        "mode=subscription",
        "payment_method_types[0]=card",
        "line_items[0][price]=" + encodeURIComponent(data.stripePriceId),
        "line_items[0][quantity]=1",
        "success_url=" + encodeURIComponent(successUrl),
        "cancel_url=" + encodeURIComponent(cancelUrl),
        "metadata[userId]=" + encodeURIComponent(data.user.userId),
        "metadata[displayName]=" + encodeURIComponent(data.user.displayName),
        "metadata[plan]=" + encodeURIComponent(data.plan),
        "locale=ja",
        "allow_promotion_codes=true"
    ].join("&");

    const res = UrlFetchApp.fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "post",
        headers: { "Authorization": "Bearer " + stripeKey },
        payload: payload,
        muteHttpExceptions: true
    });

    const session = JSON.parse(res.getContentText());

    if (session.url) {
        // 申込仮記録（決済完了前の状態）
        logSubscriptionAttempt(data, session.id);
        return jsonResponse({ status: "redirect_to_stripe", checkoutUrl: session.url, sessionId: session.id });
    } else {
        return jsonResponse({ status: "error", message: session.error ? session.error.message : "Stripe error" });
    }
}

// ── Stripe Webhook 処理 ───────────────────────────────────────────────────────
// Stripe ダッシュボード > Webhooks でこのGASのURLを登録し、
// checkout.session.completed と customer.subscription.deleted を監視する
function handleStripeWebhook(data) {
    const eventType = data.type;

    if (eventType === "checkout.session.completed") {
        const session = data.data.object;
        const userId = session.metadata.userId;
        const displayName = session.metadata.displayName;
        const plan = session.metadata.plan;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        activateSubscription(userId, displayName, plan, customerId, subscriptionId);
        sendLineNotification(userId, plan, "activated");
        notifyOwner(displayName, plan, "新規加入");
    }

    if (eventType === "customer.subscription.deleted") {
        const sub = data.data.object;
        const customerId = sub.customer;
        deactivateSubscription(customerId);
        notifyOwnerByCustomerId(customerId, "解約");
    }

    if (eventType === "invoice.payment_failed") {
        const invoice = data.data.object;
        const customerId = invoice.customer;
        const userId = getLineUserIdByCustomerId(customerId);
        if (userId) {
            sendLineMessage(userId, "⚠️ 今月のお支払いが失敗しました。カード情報をご確認ください。\nhttps://skatelab.jp/billing");
        }
    }

    return jsonResponse({ status: "ok" });
}

// ── スプレッドシート操作 ───────────────────────────────────────────────────────
function getSubSheet() {
    const ss = SpreadsheetApp.openById(PROPS.getProperty("SUBSCRIPTION_SHEET_ID") || SpreadsheetApp.getActiveSpreadsheet().getId());
    let sheet = ss.getSheetByName("サブスク会員");
    if (!sheet) {
        sheet = ss.insertSheet("サブスク会員");
        sheet.appendRow(["LINE_userId", "表示名", "プラン", "StripeCustomerId", "StripeSubscriptionId", "ステータス", "加入日", "更新日"]);
        sheet.getRange(1, 1, 1, 8).setFontWeight("bold").setBackground("#f0f0f0");
    }
    return sheet;
}

function logSubscriptionAttempt(data, sessionId) {
    // 決済試行を記録（pending状態）
    const sheet = getSubSheet();
    sheet.appendRow([
        data.user.userId,
        data.user.displayName,
        data.plan,
        "",
        sessionId,
        "pending",
        new Date().toLocaleString("ja-JP"),
        ""
    ]);
}

function activateSubscription(userId, displayName, plan, customerId, subscriptionId) {
    const sheet = getSubSheet();
    const data = sheet.getDataRange().getValues();

    // pending行を更新
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === userId && data[i][5] === "pending") {
            sheet.getRange(i + 1, 4).setValue(customerId);
            sheet.getRange(i + 1, 5).setValue(subscriptionId);
            sheet.getRange(i + 1, 6).setValue("active");
            sheet.getRange(i + 1, 8).setValue(new Date().toLocaleString("ja-JP"));
            return;
        }
    }

    // 見つからない場合は新規追加
    sheet.appendRow([userId, displayName, plan, customerId, subscriptionId, "active", new Date().toLocaleString("ja-JP"), new Date().toLocaleString("ja-JP")]);
}

function deactivateSubscription(customerId) {
    const sheet = getSubSheet();
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][3] === customerId) {
            sheet.getRange(i + 1, 6).setValue("cancelled");
            sheet.getRange(i + 1, 8).setValue(new Date().toLocaleString("ja-JP"));
            return;
        }
    }
}

function getLineUserIdByCustomerId(customerId) {
    const sheet = getSubSheet();
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][3] === customerId) return data[i][0];
    }
    return null;
}

// ── LINE通知 ──────────────────────────────────────────────────────────────────
function sendLineNotification(userId, plan, type) {
    const planNames = { basic: "ベーシック", standard: "スタンダード", premium: "プレミアム" };
    const planName = planNames[plan] || plan;

    let message = "";
    if (type === "activated") {
        message = `✅ ${planName}プランへのご加入が完了しました！\n\n` +
                  `今後は優先予約・割引特典をご利用いただけます。\n` +
                  `ご予約はこちら: https://liff.line.me/2009436433-Nh9ImTsd\n\n` +
                  `解約・変更はこちらのLINEにメッセージをお送りください。`;
    }

    sendLineMessage(userId, message);
}

function sendLineMessage(userId, text) {
    const token = PROPS.getProperty("LINE_CHANNEL_ACCESS_TOKEN");
    if (!token || !userId || userId.startsWith("web_user_")) return;

    UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
        method: "post",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        },
        payload: JSON.stringify({
            to: userId,
            messages: [{ type: "text", text: text }]
        }),
        muteHttpExceptions: true
    });
}

function notifyOwner(displayName, plan, action) {
    const ownerUserId = PROPS.getProperty("OWNER_LINE_USER_ID");
    const planNames = { basic: "ベーシック", standard: "スタンダード", premium: "プレミアム" };
    const msg = `🎉 サブスク${action}通知\n顧客: ${displayName}\nプラン: ${planNames[plan] || plan}`;
    sendLineMessage(ownerUserId, msg);
}

function notifyOwnerByCustomerId(customerId, action) {
    const sheet = getSubSheet();
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][3] === customerId) {
            notifyOwner(data[i][1], data[i][2], action);
            return;
        }
    }
}

// ── 既存の予約処理（互換性維持） ────────────────────────────────────────────
function handleReservation(data) {
    // 既存のGASコードをここに移動またはそのまま維持
    return jsonResponse({ status: "pending", message: "予約リクエストを受け付けました" });
}

// ── ユーティリティ ─────────────────────────────────────────────────────────────
function jsonResponse(obj) {
    return ContentService
        .createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}

// ── 月次サマリー（毎月1日に自動実行するトリガーを設定） ────────────────────────
function monthlySubscriptionSummary() {
    const sheet = getSubSheet();
    const data = sheet.getDataRange().getValues();

    let activeCount = 0;
    let monthlyRevenue = 0;
    const planPrices = { basic: 2000, standard: 4500, premium: 9800 };

    for (let i = 1; i < data.length; i++) {
        if (data[i][5] === "active") {
            activeCount++;
            monthlyRevenue += planPrices[data[i][2]] || 0;
        }
    }

    const ownerUserId = PROPS.getProperty("OWNER_LINE_USER_ID");
    const msg = `📊 月次サブスクまとめ\n` +
                `アクティブ会員: ${activeCount}名\n` +
                `月額収益: ¥${monthlyRevenue.toLocaleString()}\n` +
                `年換算: ¥${(monthlyRevenue * 12).toLocaleString()}`;
    sendLineMessage(ownerUserId, msg);
}
