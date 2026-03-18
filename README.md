# 🦆 Duck Race Society — DEX Bot

Telegram Bot für SOL → TRC Swap

## Setup

### 1. Environment Variables (Vercel)
```
DEX_BOT_TOKEN=         # Telegram Bot Token von @BotFather
TREASURY_PRIVATE_KEY=  # bs58 encoded Private Key der Treasury Wallet
TOKEN_MINT=            # H4FTTQ5nhGdFFqHa3FPd5TpjcXYLAokN8SYFdBq4yERL
TOKEN_RATE=            # 20000 (TRC per SOL)
MIN_SOL=               # 0.01
MAX_SOL=               # 10
RPC_URL=               # https://rpc.ankr.com/solana
```

### 2. Deploy
```bash
vercel deploy --prod
```

### 3. Webhook setzen
```bash
WEBHOOK_URL=https://YOUR-APP.vercel.app/api/dex-bot node api/setup-dex-webhook.js
```

## Bot Flow
1. /start → Wallet Adresse eingeben
2. SOL Betrag wählen (Buttons oder manuell)
3. SOL manuell an Treasury senden
4. Swap bestätigen → TRC kommt in Wallet
5. Explorer Link zur Transaction

## Befehle
- /start — Swap starten
- /balance — Treasury Balance
- /rate — Aktuellen Kurs
- /cancel — Abbrechen
- /help — Hilfe

## Sicherheit
- Wallet Format Validierung (Base58)
- Rate Limiting möglich (sessions object)
- Treasury Balance Check vor Transfer
- Fehlerbehandlung für RPC Ausfälle
