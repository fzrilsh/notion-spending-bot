# Cashout Tracker Telegram Bot

A Telegram bot written in **Node.js + TypeScript** that logs your expenses to a Notion database and provides quick summaries.

---

## Features

| Command       | Description                                                                |
| ------------- | -------------------------------------------------------------------------- |
| `/add`        | Interactive wizard to add a new expense (title → date → category → amount) |
| `/categories` | List all category options currently defined in your Notion DB              |
| `/summary`    | Show total spending for the current month and a breakdown per‑category     |

---

## Demo

```
/add
🤖 Masukkan *judul* pengeluaran:
👤 Bakso Malam
🤖 Tanggal?
• Ketik *sekarang* atau kirim `DD/MM HH:mm`
👤 sekarang
🤖 Pilih kategori:
• Makan & Minum
• Transport
👤 Makan & Minum
🤖 Jumlah (angka saja, contoh 20000):
👤 18000
🤖 ✅ Tersimpan! Bakso Malam - Rp 18.000
```

---

## Prerequisites

* **Node.js** ≥ 18
* **Yarn** or **npm**
* A **Notion** workstation & database
* A **Notion Internal Integration Token** with *Read content* and *Insert content* permissions
* A **Telegram Bot Token** from @BotFather

---

## Setup

1. **Clone & install**

   ```bash
   git clone https://github.com/fzrilsh/notion-spending-bot.git
   cd notion-spending-bot
   yarn install   # or npm i
   ```

2. **Configure environment variables** – create `.env`:

   ```env
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
   NOTION_TOKEN=secret_xyz...
   NOTION_DB_ID=1e1f48d4e2d080378184e85932815e25
   ```

   *How to get `NOTION_DB_ID`* : open the database in your browser, copy the 32‑character hex string right after `notion.so/` and before any `?` query.

3. **Share database with integration**

   * In Notion, open the database → **Share** → *Connections* (⚡) → **Invite** your integration → *Can edit*.

4. **Run in dev‑mode**

   ```bash
   yarn dev   # ts-node with live‑reload
   ```

   Or run in prod:

   ```bash
   yarn start
   ```

---

## Scripts

| Script       | Purpose                         |
| ------------ | ------------------------------- |
| `yarn dev`   | Run bot with ts‑node + nodemon  |
| `yarn start` | Run compiled JS from `index.ts`    |

---

## Project Structure

```
├── index.ts        # main bot logic
├── .env.example    # sample env
└── README.md
```

---

## Extending

* Add new commands by calling `bot.command()`.
* Use Notion filters in `monthlySummary()` to customise reports.
* Replace currency formatting by editing `format()` helper.

---

## License

MIT © 2025 Fazril Syaveral Hillaby