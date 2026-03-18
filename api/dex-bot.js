// ════════════════════════════════════════════════════════════════════
// 🦆 DUCK RACE SOCIETY — Telegram DEX Bot
// Wallet Connect → SOL Input → Swap → SPL Token Transfer
// Deploy: Vercel Serverless Function
// ════════════════════════════════════════════════════════════════════

const { Connection, PublicKey, Keypair, Transaction } = require("@solana/web3.js");
const { getOrCreateAssociatedTokenAccount, transfer, getAccount } = require("@solana/spl-token");
const bs58 = require("bs58");

// ── CONFIG ──
const BOT_TOKEN        = process.env.DEX_BOT_TOKEN;
const TREASURY_PRIVKEY = process.env.TREASURY_PRIVATE_KEY; // bs58 encoded
const TOKEN_MINT       = process.env.TOKEN_MINT || "H4FTTQ5nhGdFFqHa3FPd5TpjcXYLAokN8SYFdBq4yERL";
const TOKEN_RATE       = parseFloat(process.env.TOKEN_RATE || "25000"); // TRC per SOL
const MIN_SOL          = parseFloat(process.env.MIN_SOL || "0.5");
const MAX_SOL          = parseFloat(process.env.MAX_SOL || "10");
const RPC_URL          = process.env.RPC_URL || "https://rpc.ankr.com/solana";
const EXPLORER         = "https://solscan.io";

const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── SESSION STORE (in-memory, replace with Redis for production) ──
const sessions = {};

function getSession(userId) {
  if (!sessions[userId]) {
    sessions[userId] = { step: "idle", wallet: null, solAmount: null };
  }
  return sessions[userId];
}

// ── TELEGRAM API HELPERS ──
async function tgPost(method, body) {
  const res = await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMessage(chatId, text, extra = {}) {
  return tgPost("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

async function editMessage(chatId, messageId, text, extra = {}) {
  return tgPost("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

async function answerCallback(callbackQueryId, text = "") {
  return tgPost("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

// ── SOL PRICE (optional, for USD display) ──
async function getSolPrice() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const data = await res.json();
    return data?.solana?.usd || 0;
  } catch {
    return 0;
  }
}
async function getTreasuryBalance() {
  try {
    const conn = new Connection(RPC_URL, "confirmed");
    const mint = new PublicKey(TOKEN_MINT);
    const treasuryAddr = process.env.TREASURY_PUBLIC_KEY || "5sDfMWBNFMne13aJLhiG3k7V8MwULmHfQrkt2eHupSQ1";
    const treasury = new PublicKey(treasuryAddr);
    const tokenAccounts = await conn.getParsedTokenAccountsByOwner(treasury, { mint });
    if (!tokenAccounts.value.length) return 500000000;
    const bal = tokenAccounts.value[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 500000000;
    return bal;
  } catch (e) {
    console.error("Treasury balance error:", e.message);
    return 500000000;
  }
}

// ── VALIDATE SOLANA WALLET ──
function isValidWallet(addr) {
  try {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return false;
    new PublicKey(addr);
    return true;
  } catch {
    return false;
  }
}

// ── SPL TOKEN TRANSFER ──
async function transferTokens(toWalletAddr, tokenAmount) {
  const conn = new Connection(RPC_URL, "confirmed");

  // Load treasury keypair
  const secretKey = bs58.decode(TREASURY_PRIVKEY);
  const treasury = Keypair.fromSecretKey(secretKey);

  const mint = new PublicKey(TOKEN_MINT);
  const toWallet = new PublicKey(toWalletAddr);

  // Get or create treasury token account
  const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
    conn,
    treasury,
    mint,
    treasury.publicKey
  );

  // Get or create recipient token account
  const toTokenAccount = await getOrCreateAssociatedTokenAccount(
    conn,
    treasury, // payer for account creation
    mint,
    toWallet
  );

  // Calculate amount with decimals (6 decimals for TRC)
  const decimals = 6;
  const rawAmount = Math.floor(tokenAmount * Math.pow(10, decimals));

  // Check treasury balance
  const fromAccount = await getAccount(conn, fromTokenAccount.address);
  if (Number(fromAccount.amount) < rawAmount) {
    throw new Error("INSUFFICIENT_TREASURY_BALANCE");
  }

  // Execute transfer
  const sig = await transfer(
    conn,
    treasury,
    fromTokenAccount.address,
    toTokenAccount.address,
    treasury.publicKey,
    rawAmount
  );

  return sig;
}

// ── TREASURY BALANCE CHECK ──
async function getTreasuryBalance() {
  try {
    const conn = new Connection(RPC_URL, "confirmed");
    const mint = new PublicKey(TOKEN_MINT);
    const treasury = new PublicKey(process.env.TREASURY_PUBLIC_KEY || "5sDfMWBNFMne13aJLhiG3k7V8MwULmHfQrkt2eHupSQ1");
    const tokenAccounts = await conn.getParsedTokenAccountsByOwner(treasury, { mint });
    const bal = tokenAccounts.value[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
    return bal;
  } catch {
    return 0;
  }
}

// ── HANDLERS ──

// /start command
async function handleStart(chatId, userId, firstName) {
  const sess = getSession(userId);
  sess.step = "idle";

  const treasuryBal = await getTreasuryBalance();
  const solPrice = await getSolPrice();

  await sendMessage(chatId,
    `🦆 <b>DUCK RACE SOCIETY — DEX</b>\n\n` +
    `💱 Swap SOL → TRC\n\n` +
    `📊 <b>Rate:</b> 1 SOL = <b>25,000 TRC</b>\n` +
    `💰 <b>SOL:</b> $${solPrice.toFixed(2)}\n` +
    `🏦 <b>Treasury:</b> ${treasuryBal.toLocaleString()} TRC\n\n` +
    `👇 Öffne das DEX Interface:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💱 DEX Interface öffnen", url: "https://duck-race-dex-bot.vercel.app" }],
          [{ text: "🎮 Duck Race spielen", url: "https://duck-race-society.vercel.app" }],
          [{ text: "📊 Kurs & Info", callback_data: "rate_info" }]
        ]
      }
    }
  );
}

  await sendMessage(chatId,
    `🦆 <b>DUCK RACE SOCIETY — DEX BOT</b>\n\n` +
    `💱 Swap SOL → TRC direkt hier im Chat!\n\n` +
    `📊 <b>Rate:</b> 1 SOL = <b>${TOKEN_RATE.toLocaleString()} TRC</b>\n` +
    `💰 <b>SOL Preis:</b> $${solPrice.toFixed(2)}\n` +
    `🏦 <b>Treasury:</b> ${treasuryBal.toLocaleString()} TRC verfügbar\n` +
    `📏 <b>Min:</b> ${MIN_SOL} SOL | <b>Max:</b> ${MAX_SOL} SOL\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `👇 <b>Sende deine Solana Wallet Adresse:</b>`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: "ℹ️ Wie funktioniert's?", callback_data: "how_it_works" },
          { text: "📊 Kurs & Info", callback_data: "rate_info" }
        ]]
      }
    }
  );
}

// Wallet received
async function handleWallet(chatId, userId, walletAddr) {
  const sess = getSession(userId);

  if (!isValidWallet(walletAddr)) {
    await sendMessage(chatId,
      `❌ <b>Ungültige Wallet Adresse!</b>\n\n` +
      `Bitte sende eine gültige Solana Adresse (32-44 Zeichen, Base58)\n\n` +
      `Beispiel: <code>5sDfMWBNFMne13aJLhiG3k7V8MwULmHfQrkt2eHupSQ1</code>`
    );
    return;
  }

  sess.wallet = walletAddr;
  sess.step = "await_sol";

  // Check if wallet has existing TRC
  let existingTRC = 0;
  try {
    const conn = new Connection(RPC_URL, "confirmed");
    const mint = new PublicKey(TOKEN_MINT);
    const pk = new PublicKey(walletAddr);
    const accs = await conn.getParsedTokenAccountsByOwner(pk, { mint });
    existingTRC = accs.value[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
  } catch {}

  await sendMessage(chatId,
    `✅ <b>Wallet verbunden!</b>\n\n` +
    `👛 <code>${walletAddr}</code>\n` +
    `💎 TRC Balance: <b>${existingTRC.toLocaleString()} TRC</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 <b>Wie viel SOL möchtest du swappen?</b>\n\n` +
    `Sende den Betrag (z.B. <code>0.5</code>)\n` +
    `Min: ${MIN_SOL} SOL | Max: ${MAX_SOL} SOL`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "0.1 SOL", callback_data: "sol_0.1" },
            { text: "0.5 SOL", callback_data: "sol_0.5" },
            { text: "1 SOL", callback_data: "sol_1" },
          ],
          [
            { text: "2 SOL", callback_data: "sol_2" },
            { text: "5 SOL", callback_data: "sol_5" },
            { text: "10 SOL", callback_data: "sol_10" },
          ],
          [
            { text: "🔄 Andere Wallet", callback_data: "change_wallet" },
          ]
        ]
      }
    }
  );
}

// SOL amount received — show swap confirmation
async function handleSolAmount(chatId, userId, solAmount, messageId = null) {
  const sess = getSession(userId);

  const sol = parseFloat(solAmount);
  if (isNaN(sol) || sol < MIN_SOL || sol > MAX_SOL) {
    await sendMessage(chatId,
      `❌ <b>Ungültiger Betrag!</b>\n\n` +
      `Bitte sende einen Betrag zwischen ${MIN_SOL} und ${MAX_SOL} SOL\n` +
      `Beispiel: <code>0.5</code>`
    );
    return;
  }

  sess.solAmount = sol;
  sess.step = "await_confirm";

  const tokenAmount = sol * TOKEN_RATE;
  const solPrice = await getSolPrice();
  const usdValue = sol * solPrice;

  const confirmText =
    `🔄 <b>SWAP BESTÄTIGUNG</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `📤 <b>Du sendest:</b>\n` +
    `   ${sol} SOL${solPrice > 0 ? ` (~$${usdValue.toFixed(2)})` : ""}\n\n` +
    `📥 <b>Du erhältst:</b>\n` +
    `   <b>${tokenAmount.toLocaleString()} TRC</b>\n\n` +
    `📊 <b>Rate:</b> 1 SOL = ${TOKEN_RATE.toLocaleString()} TRC\n` +
    `👛 <b>An Wallet:</b>\n` +
    `   <code>${sess.wallet}</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `⚠️ <b>Wichtig:</b> Sende ${sol} SOL manuell an die Treasury:\n` +
    `<code>5sDfMWBNFMne13aJLhiG3k7V8MwULmHfQrkt2eHupSQ1</code>\n\n` +
    `Dann klicke <b>SWAP BESTÄTIGEN</b> ✅`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ SWAP BESTÄTIGEN", callback_data: `confirm_swap_${sol}` },
        { text: "❌ Abbrechen", callback_data: "cancel_swap" },
      ],
      [
        { text: "🔄 Betrag ändern", callback_data: "change_amount" },
      ]
    ]
  };

  if (messageId) {
    await editMessage(chatId, messageId, confirmText, { reply_markup: keyboard });
  } else {
    await sendMessage(chatId, confirmText, { reply_markup: keyboard });
  }
}

// Execute swap
async function handleConfirmSwap(chatId, userId, messageId, sol) {
  const sess = getSession(userId);

  if (!sess.wallet || !sol) {
    await sendMessage(chatId, "❌ Session abgelaufen. Bitte /start erneut.");
    return;
  }

  sess.step = "processing";

  // Show processing message
  await editMessage(chatId, messageId,
    `⏳ <b>SWAP WIRD AUSGEFÜHRT...</b>\n\n` +
    `💱 ${sol} SOL → ${(sol * TOKEN_RATE).toLocaleString()} TRC\n` +
    `👛 <code>${sess.wallet}</code>\n\n` +
    `<i>Bitte warten...</i>`
  );

  try {
    const tokenAmount = sol * TOKEN_RATE;
    const sig = await transferTokens(sess.wallet, tokenAmount);

    sess.step = "idle";

    // Success message
    await editMessage(chatId, messageId,
      `🎉 <b>SWAP ERFOLGREICH!</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ <b>${tokenAmount.toLocaleString()} TRC</b> gesendet!\n\n` +
      `📤 Von: Treasury\n` +
      `📥 An: <code>${sess.wallet}</code>\n` +
      `💰 Betrag: ${sol} SOL → ${tokenAmount.toLocaleString()} TRC\n\n` +
      `🔍 <b>Transaction:</b>\n` +
      `<a href="${EXPLORER}/tx/${sig}">${sig.slice(0, 20)}...${sig.slice(-8)}</a>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🦆 Viel Erfolg beim Duck Race!`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔍 Explorer öffnen", url: `${EXPLORER}/tx/${sig}` }],
            [{ text: "🔄 Nochmal swappen", callback_data: "restart" }],
            [{ text: "🎮 Zum Spiel", url: "https://duck-race-society.vercel.app" }],
          ]
        }
      }
    );

  } catch (err) {
    sess.step = "await_confirm";

    let errMsg = "Unbekannter Fehler";
    if (err.message === "INSUFFICIENT_TREASURY_BALANCE") {
      errMsg = "Treasury hat nicht genug TRC. Bitte Admin kontaktieren.";
    } else if (err.message?.includes("Invalid public key")) {
      errMsg = "Ungültige Wallet Adresse.";
    } else {
      errMsg = err.message?.slice(0, 100) || errMsg;
    }

    await editMessage(chatId, messageId,
      `❌ <b>SWAP FEHLGESCHLAGEN</b>\n\n` +
      `Fehler: ${errMsg}\n\n` +
      `Bitte versuche es erneut oder kontaktiere den Support.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Erneut versuchen", callback_data: `confirm_swap_${sol}` }],
            [{ text: "❌ Abbrechen", callback_data: "cancel_swap" }],
          ]
        }
      }
    );
  }
}

// ── CALLBACK QUERY HANDLER ──
async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const msgId  = query.message.message_id;
  const data   = query.data;
  const sess   = getSession(userId);

  await answerCallback(query.id);

  if (data === "how_it_works") {
    await sendMessage(chatId,
      `ℹ️ <b>Wie funktioniert der DEX Bot?</b>\n\n` +
      `1️⃣ Sende deine Solana Wallet Adresse\n` +
      `2️⃣ Wähle wie viel SOL du swappen möchtest\n` +
      `3️⃣ Sende den SOL-Betrag manuell an die Treasury\n` +
      `4️⃣ Bestätige den Swap im Bot\n` +
      `5️⃣ TRC Token kommen direkt in deine Wallet\n\n` +
      `💡 <b>Tipp:</b> Du brauchst min. 10.000 TRC für Duck Race!`
    );
    return;
  }

  if (data === "rate_info") {
    const solPrice = 93.81;
    const treasuryBal = await getTreasuryBalance();
    await sendMessage(chatId,
      `📊 <b>Kurs & Token Info</b>\n\n` +
      `💱 Rate: 1 SOL = ${TOKEN_RATE.toLocaleString()} TRC\n` +
      `💵 SOL Preis: $${solPrice.toFixed(2)}\n` +
      `🏦 Treasury Balance: ${treasuryBal.toLocaleString()} TRC\n` +
      `🪙 Token Mint:\n<code>${TOKEN_MINT}</code>\n\n` +
      `🔍 <a href="${EXPLORER}/token/${TOKEN_MINT}">Token auf Solscan</a>`
    );
    return;
  }

  if (data === "change_wallet") {
    sess.step = "await_wallet";
    sess.wallet = null;
    await sendMessage(chatId, "👛 Sende deine neue Solana Wallet Adresse:");
    return;
  }

  if (data === "change_amount") {
    sess.step = "await_sol";
    await sendMessage(chatId,
      `💰 <b>Neuen SOL Betrag eingeben:</b>\n\nMin: ${MIN_SOL} SOL | Max: ${MAX_SOL} SOL`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "0.1 SOL", callback_data: "sol_0.1" },
              { text: "0.5 SOL", callback_data: "sol_0.5" },
              { text: "1 SOL", callback_data: "sol_1" },
            ],
            [
              { text: "2 SOL", callback_data: "sol_2" },
              { text: "5 SOL", callback_data: "sol_5" },
              { text: "10 SOL", callback_data: "sol_10" },
            ]
          ]
        }
      }
    );
    return;
  }

  if (data.startsWith("sol_")) {
    const sol = parseFloat(data.replace("sol_", ""));
    await handleSolAmount(chatId, userId, sol, msgId);
    return;
  }

  if (data.startsWith("confirm_swap_")) {
    const sol = parseFloat(data.replace("confirm_swap_", ""));
    await handleConfirmSwap(chatId, userId, msgId, sol);
    return;
  }

  if (data === "cancel_swap") {
    sess.step = "idle";
    await editMessage(chatId, msgId,
      `❌ <b>Swap abgebrochen</b>\n\nSende /start um neu zu beginnen.`
    );
    return;
  }

  if (data === "restart") {
    await handleStart(chatId, userId, query.from.first_name);
    return;
  }
}

// ── MAIN WEBHOOK HANDLER ──
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, message: "DEX Bot running" });
  }

  try {
    const update = req.body;

    // Callback Query (button press)
    if (update.callback_query) {
      await handleCallback(update.callback_query);
      return res.status(200).json({ ok: true });
    }

    // Message
    if (update.message) {
      const msg    = update.message;
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const text   = msg.text?.trim() || "";
      const sess   = getSession(userId);

      // Commands
      if (text === "/start" || text.startsWith("/start ")) {
        await handleStart(chatId, userId, msg.from.first_name);
        return res.status(200).json({ ok: true });
      }

      if (text === "/help") {
        await sendMessage(chatId,
          `🦆 <b>Duck Race DEX Bot — Befehle</b>\n\n` +
          `/start — Swap starten\n` +
          `/balance — Treasury Balance prüfen\n` +
          `/rate — Aktuellen Kurs anzeigen\n` +
          `/cancel — Aktuellen Swap abbrechen`
        );
        return res.status(200).json({ ok: true });
      }

      if (text === "/balance") {
        const bal = await getTreasuryBalance();
        await sendMessage(chatId, `🏦 Treasury Balance: <b>${bal.toLocaleString()} TRC</b>`);
        return res.status(200).json({ ok: true });
      }

      if (text === "/rate") {
        const solPrice = await getSolPrice();
        await sendMessage(chatId,
          `📊 Kurs: 1 SOL = <b>${TOKEN_RATE.toLocaleString()} TRC</b>\n` +
          `💵 SOL = $${solPrice.toFixed(2)}`
        );
        return res.status(200).json({ ok: true });
      }

      if (text === "/cancel") {
        sess.step = "idle";
        await sendMessage(chatId, "❌ Abgebrochen. Sende /start um neu zu beginnen.");
        return res.status(200).json({ ok: true });
      }

      // Flow based on session step
      if (sess.step === "await_wallet") {
        await handleWallet(chatId, userId, text);
        return res.status(200).json({ ok: true });
      }

      if (sess.step === "await_sol") {
        await handleSolAmount(chatId, userId, text);
        return res.status(200).json({ ok: true });
      }

      // Default
      await sendMessage(chatId,
        `🦆 Sende /start um einen Swap zu beginnen!`
      );
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("DEX Bot Error:", err);
    return res.status(200).json({ ok: true });
  }
};
