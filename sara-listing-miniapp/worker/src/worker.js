export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "sara-listing-bot" });
    }

    // ---- Admin API (token protected) ----
    if (url.pathname.startsWith("/admin/api/")) {
      const token =
        url.searchParams.get("token") || request.headers.get("x-admin-token");
      if (!token || token !== env.ADMIN_TOKEN)
        return json({ ok: false, error: "unauthorized" }, 401);

      if (url.pathname === "/admin/api/leads") {
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 500);
        const q = (url.searchParams.get("q") || "").trim();
        const where = q
          ? `WHERE project_name LIKE ? OR symbol LIKE ? OR contract LIKE ? OR telegram_username LIKE ?`
          : "";
        const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : [];
        const stmt = env.DB.prepare(
          `SELECT * FROM leads ${where} ORDER BY created_at DESC LIMIT ${limit}`
        ).bind(...params);

        const rows = (await stmt.all()).results || [];
        return json({ ok: true, rows });
      }

      if (url.pathname === "/admin/api/export.csv") {
        const stmt = env.DB.prepare(
          `SELECT * FROM leads ORDER BY created_at DESC LIMIT 2000`
        );
        const rows = (await stmt.all()).results || [];
        const csv = toCSV(rows);
        return new Response(csv, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="sara_leads.csv"`,
          },
        });
      }

      return json({ ok: false, error: "not_found" }, 404);
    }

    // ---- Telegram webhook endpoint ----
    if (url.pathname === "/telegram/webhook") {
      const secret = request.headers.get("x-telegram-bot-api-secret-token");
      if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
        return json({ ok: false, error: "bad_secret" }, 401);
      }
      if (request.method !== "POST")
        return json({ ok: false, error: "method_not_allowed" }, 405);

      const update = await request.json();
      await handleTelegramUpdate(update, env);
      return json({ ok: true });
    }

    return json({ ok: false, error: "not_found" }, 404);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handleTelegramUpdate(update, env) {
  if (update.message) {
    const msg = update.message;

    // WebApp data (from Mini App)
    if (msg.web_app_data?.data) {
      await handleWebAppData(msg, env);
      return;
    }

    const text = (msg.text || "").trim();
    if (!text) return;

    if (text.startsWith("/start")) {
      await sendStart(msg.chat.id, env);
      return;
    }

    if (text.startsWith("/help")) {
      await sendHelp(msg.chat.id, env);
      return;
    }

    await tgSendMessage(
      env,
      msg.chat.id,
      ["Hi — I’m Sara Chen’s listing desk.", "", "Use /start to open the Mini App or request a listing readiness review."].join("\n")
    );
    return;
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat?.id;
    const data = cq.data || "";
    if (!chatId) return;

    await tgAnswerCallbackQuery(env, cq.id);

    if (data === "SHOW_PRICING") {
      await tgSendMessage(env, chatId, pricingText());
      return;
    }
    if (data === "SHOW_CHECKLIST") {
      await tgSendMessage(env, chatId, checklistText());
      return;
    }
    if (data === "DOWNLOAD_PDFS") {
      await tgSendMessage(env, chatId, downloadText(env));
      return;
    }
    return;
  }
}

async function sendStart(chatId, env) {
  const text =
`Welcome to Sara Chen’s Listing Desk.

I help token teams accelerate credibility and market valuation perception by structuring their CoinMarketCap + CoinGecko listing readiness and submission package.

Choose an option below:`;

  const replyMarkup = {
    inline_keyboard: [
      [{ text: "🚀 Open Listing Desk (Mini App)", web_app: { url: env.APP_ORIGIN } }],
      [
        { text: "📄 Download PDFs", callback_data: "DOWNLOAD_PDFS" },
        { text: "💼 Pricing", callback_data: "SHOW_PRICING" },
      ],
      [{ text: "✅ Readiness Checklist", callback_data: "SHOW_CHECKLIST" }],
    ],
  };

  await tgSendMessage(env, chatId, text, replyMarkup);
}

async function sendHelp(chatId, env) {
  await tgSendMessage(
    env,
    chatId,
`Commands:
/start — Open menu
/help — Help

Tip: Use the Mini App to submit a Listing Readiness Review request.`
  );
}

async function handleWebAppData(message, env) {
  const chatId = message.chat?.id?.toString() || "";
  const from = message.from || {};
  const userId = from.id?.toString() || "";
  const username = from.username ? `@${from.username}` : "";
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();

  let parsed = null;
  try {
    parsed = JSON.parse(message.web_app_data.data);
  } catch {
    parsed = { type: "unknown", raw: message.web_app_data.data };
  }

  const lead = parsed?.lead || {};
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const record = {
    id,
    created_at: now,
    telegram_user_id: userId,
    telegram_username: username,
    telegram_name: name,
    chat_id: chatId,
    project_name: (lead.project_name || "").slice(0, 200),
    symbol: (lead.symbol || "").slice(0, 50),
    network: (lead.network || "").slice(0, 80),
    urgency: (lead.urgency || "").slice(0, 80),
    contract: (lead.contract || "").slice(0, 200),
    links: (lead.links || "").slice(0, 4000),
    goal: (lead.goal || "").slice(0, 4000),
    raw_message: (parsed?.message || "").slice(0, 4000),
    raw_json: JSON.stringify(parsed).slice(0, 8000),
  };

  await env.DB.prepare(
    `INSERT INTO leads
     (id, created_at, telegram_user_id, telegram_username, telegram_name, chat_id,
      project_name, symbol, network, urgency, contract, links, goal, raw_message, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    record.id, record.created_at, record.telegram_user_id, record.telegram_username, record.telegram_name, record.chat_id,
    record.project_name, record.symbol, record.network, record.urgency, record.contract, record.links, record.goal,
    record.raw_message, record.raw_json
  ).run();

  const adminChatId = env.ADMIN_CHAT_ID;

  const lines = [
    "📩 NEW LISTING REVIEW REQUEST",
    "",
    `From: ${name || "Unknown"} ${username}`.trim(),
    `User ID: ${userId}`,
    "",
    `Project: ${record.project_name || "-"}`,
    `Symbol: ${record.symbol || "-"}`,
    `Network: ${record.network || "-"}`,
    `Urgency: ${record.urgency || "-"}`,
    "",
    `Contract: ${record.contract || "-"}`,
    "",
    "Links:",
    `${record.links || "-"}`,
    "",
    "Goal:",
    `${record.goal || "-"}`,
    "",
    `Lead ID: ${record.id}`,
    `Time: ${record.created_at}`,
  ];

  if (adminChatId) {
    await tgSendMessage(env, adminChatId, lines.join("\n"));
  }

  await tgSendMessage(
    env,
    chatId,
`✅ Received.

Sara’s desk has logged your request.
You can also send any extra links or details here in chat.`
  );
}

function pricingText() {
  return [
    "💼 PRICING (Framework)",
    "",
    "Tier 1 — Listing Preparation Package",
    "• Readiness audit + documentation structuring",
    "",
    "Tier 2 — End-to-End Listing Support",
    "• Preparation + submission packaging + positioning",
    "",
    "Tier 3 — Valuation Acceleration Framework",
    "• Tier 2 + post-listing visibility strategy",
    "",
    "Note: No approvals are guaranteed; the objective is improved readiness and approval probability.",
  ].join("\n");
}

function checklistText() {
  return [
    "✅ LISTING READINESS CHECKLIST",
    "",
    "1) Contract verified on explorer",
    "2) Minimum liquidity depth established",
    "3) At least 1 active trading pair",
    "4) Website + litepaper/whitepaper",
    "5) Tokenomics breakdown",
    "6) Circulating vs total supply clarity",
    "7) Active social channels",
    "8) Clear project identity",
    "",
    "Rule: 7+ confirmed → proceed. Under 7 → preparation phase first.",
  ].join("\n");
}

function downloadText(env) {
  return [
    "📄 DOWNLOAD PDFs",
    "",
    `1) Listing Proposal: ${env.APP_ORIGIN}/Listing_Proposal_Sara_Chen.pdf`,
    `2) Pricing Framework: ${env.APP_ORIGIN}/Pricing_Framework_Sara_Chen.pdf`,
    `3) Readiness Checklist: ${env.APP_ORIGIN}/Token_Readiness_Checklist_Sara_Chen.pdf`,
    `4) Authority Script: ${env.APP_ORIGIN}/Authority_Positioning_Script_Sara_Chen.pdf`,
  ].join("\n");
}

async function tgSendMessage(env, chatId, text, replyMarkup = null) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function tgAnswerCallbackQuery(env, callbackQueryId) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

function toCSV(rows) {
  const headers = [
    "id","created_at","telegram_user_id","telegram_username","telegram_name","chat_id",
    "project_name","symbol","network","urgency","contract","links","goal","raw_message"
  ];
  const esc = (v) => {
    const s = (v ?? "").toString().replaceAll('"', '""');
    return `"${s}"`;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => esc(r[h])).join(","));
  }
  return lines.join("\n");
}
