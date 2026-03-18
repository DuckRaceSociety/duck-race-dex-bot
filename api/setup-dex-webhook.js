// ── SETUP WEBHOOK ──
// Run once: node setup-dex-webhook.js

const BOT_TOKEN = process.env.DEX_BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://duck-race-sniper-bot.vercel.app/api/dex-bot";

async function setup() {
  console.log("Setting up DEX Bot webhook...");
  console.log("URL:", WEBHOOK_URL);

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: WEBHOOK_URL,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    }),
  });

  const data = await res.json();
  console.log("Result:", JSON.stringify(data, null, 2));

  // Get bot info
  const infoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
  const info = await infoRes.json();
  console.log("Bot:", info.result?.username);
}

setup().catch(console.error);
