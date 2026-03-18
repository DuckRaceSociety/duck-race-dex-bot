// ════════════════════════════════════════════════════════════════════
// 🦆 DUCK RACE SOCIETY — DEX Swap API
// Verifies SOL transaction on-chain → sends TRC from Treasury
// Deploy: /api/dex-swap.js on Vercel
// ════════════════════════════════════════════════════════════════════

const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { getOrCreateAssociatedTokenAccount, transfer, getAccount } = require("@solana/spl-token");
const bs58 = require("bs58");

const TREASURY_PRIVKEY = process.env.TREASURY_PRIVATE_KEY;
const TOKEN_MINT       = process.env.TOKEN_MINT || "H4FTTQ5nhGdFFqHa3FPd5TpjcXYLAokN8SYFdBq4yERL";
const TREASURY_ADDR    = process.env.TREASURY_PUBLIC_KEY || "5sDfMWBNFMne13aJLhiG3k7V8MwULmHfQrkt2eHupSQ1";
const TOKEN_RATE       = parseFloat(process.env.TOKEN_RATE || "25000");
const MIN_SOL          = parseFloat(process.env.MIN_SOL || "0.5");
const MAX_SOL          = parseFloat(process.env.MAX_SOL || "10");
const RPC_URL          = process.env.RPC_URL || "https://rpc.ankr.com/solana";
const TOKEN_DECIMALS   = 6;

// Track processed transactions (prevent double-spend)
const processedTxs = new Set();

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { txSig, wallet, solAmount, trcAmount } = req.body || {};

  // Validate input
  if (!txSig || !wallet || !solAmount || !trcAmount) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Validate wallet
  try { new PublicKey(wallet); } catch {
    return res.status(400).json({ error: "Invalid wallet address" });
  }

  // Validate amounts
  const sol = parseFloat(solAmount);
  if (isNaN(sol) || sol < MIN_SOL || sol > MAX_SOL) {
    return res.status(400).json({ error: `SOL amount must be between ${MIN_SOL} and ${MAX_SOL}` });
  }

  // Prevent double processing
  if (processedTxs.has(txSig)) {
    return res.status(400).json({ error: "Transaction already processed" });
  }

  try {
    const conn = new Connection(RPC_URL, "confirmed");

    // ── VERIFY TRANSACTION ON-CHAIN ──
    console.log(`Verifying TX: ${txSig}`);
    const txInfo = await conn.getParsedTransaction(txSig, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed"
    });

    if (!txInfo) {
      // Wait and retry once
      await new Promise(r => setTimeout(r, 3000));
      const txInfo2 = await conn.getParsedTransaction(txSig, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed"
      });
      if (!txInfo2) return res.status(400).json({ error: "Transaction not found on-chain" });
    }

    // Verify sender
    const senderKey = txInfo?.transaction?.message?.accountKeys?.[0]?.pubkey?.toString();
    if (senderKey !== wallet) {
      return res.status(400).json({ error: "Transaction sender does not match wallet" });
    }

    // Verify SOL was sent to Treasury
    const instructions = txInfo?.transaction?.message?.instructions || [];
    let verifiedLamports = 0;

    for (const ix of instructions) {
      if (ix.parsed?.type === "transfer" &&
          ix.parsed?.info?.destination === TREASURY_ADDR &&
          ix.parsed?.info?.source === wallet) {
        verifiedLamports = ix.parsed.info.lamports;
      }
    }

    if (verifiedLamports === 0) {
      return res.status(400).json({ error: "No SOL transfer to treasury found in transaction" });
    }

    const verifiedSol = verifiedLamports / LAMPORTS_PER_SOL;
    const expectedTRC = Math.floor(verifiedSol * TOKEN_RATE);

    console.log(`Verified: ${verifiedSol} SOL → ${expectedTRC} TRC for ${wallet}`);

    // Mark as processed
    processedTxs.add(txSig);

    // ── SEND TRC FROM TREASURY ──
    const secretKey = bs58.decode(TREASURY_PRIVKEY);
    const treasury = Keypair.fromSecretKey(secretKey);
    const mint = new PublicKey(TOKEN_MINT);
    const toWallet = new PublicKey(wallet);

    // Get treasury token account
    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
      conn, treasury, mint, treasury.publicKey
    );

    // Get or create recipient token account
    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
      conn, treasury, mint, toWallet
    );

    // Check treasury TRC balance
    const fromAccount = await getAccount(conn, fromTokenAccount.address);
    const rawAmount = BigInt(expectedTRC * Math.pow(10, TOKEN_DECIMALS));

    if (fromAccount.amount < rawAmount) {
      return res.status(500).json({ error: "Insufficient TRC in treasury" });
    }

    // Execute TRC transfer
    const trcSig = await transfer(
      conn,
      treasury,
      fromTokenAccount.address,
      toTokenAccount.address,
      treasury.publicKey,
      rawAmount
    );

    console.log(`TRC sent: ${trcSig}`);

    return res.status(200).json({
      ok: true,
      message: `${expectedTRC.toLocaleString()} TRC sent to ${wallet}`,
      solReceived: verifiedSol,
      trcSent: expectedTRC,
      trcTx: trcSig,
      solTx: txSig,
    });

  } catch (err) {
    console.error("DEX Swap Error:", err);
    processedTxs.delete(txSig); // Allow retry on error
    return res.status(500).json({ error: err.message || "Swap failed" });
  }
};
