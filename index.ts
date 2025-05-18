// src/bot.ts
import 'dotenv/config';
import axios from 'axios';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { Telegraf, Scenes, session, Context } from 'telegraf';

dayjs.extend(customParseFormat);

/* ---------------- env ---------------- */
interface Env {
  TELEGRAM_BOT_TOKEN: string;
  NOTION_TOKEN: string;
  NOTION_DB_ID: string;
}
const { TELEGRAM_BOT_TOKEN, NOTION_TOKEN, NOTION_DB_ID } =
  process.env as NodeJS.ProcessEnv & Env;

if (!TELEGRAM_BOT_TOKEN) throw new Error('BOT token missing');

/* -------------- wizard types ---------- */
interface WizardState {
  payload: {
    title?: string;
    date?: string;
    category?: string;
    amount?: number;
  };
}
type BotContext = Context & Scenes.WizardContext<WizardState>;

/* -------------- /add wizard ----------- */
const addWizard = new Scenes.WizardScene<BotContext>(
  'add-wizard',
  async (ctx) => {
    ctx.wizard.state.payload = {};
    await ctx.reply('Masukkan *judul* pengeluaran:', { parse_mode: 'Markdown' });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!('text' in ctx.message)) return;
    ctx.wizard.state.payload.title = ctx.message.text.trim();

    await ctx.reply(
      'Tanggal?\n• Ketik *sekarang* untuk waktu saat ini\n• Atau `DD/MM HH:mm`',
      { parse_mode: 'Markdown' }
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!('text' in ctx.message)) return;

    const txt = ctx.message.text.trim().toLowerCase();
    let dateISO: string;

    if (txt === 'sekarang') {
      dateISO = dayjs().toISOString();
    } else {
      const d = dayjs(txt, ['DD/MM HH:mm'], true).year(dayjs().year());
      if (!d.isValid()) {
        await ctx.reply('Format salah. Gunakan `DD/MM HH:mm`.');
        return; // tetap di step ini
      }
      dateISO = d.toISOString();
    }
    ctx.wizard.state.payload.date = dateISO;

    const cats = await getCategories();
    await ctx.reply(
      'Pilih kategori (ketik persis):\n' + cats.map((c) => `• ${c}`).join('\n')
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!('text' in ctx.message)) return;
    ctx.wizard.state.payload.category = ctx.message.text.trim();

    await ctx.reply('Jumlah (angka saja, contoh 20000):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!('text' in ctx.message)) return;
    const amt = Number(ctx.message.text.replace(/\D/g, ''));
    if (Number.isNaN(amt) || amt <= 0) {
      await ctx.reply('Jumlah tidak valid, masukkan lagi:');
      return;
    }
    ctx.wizard.state.payload.amount = amt;

    const { title, date, category, amount } = ctx.wizard.state.payload;
    if (!title || !date || !category || !amount) return ctx.scene.leave();

    await addToNotion({ title, date, category, amount });
    await ctx.reply(`✅ Tersimpan! ${title} - Rp ${amount.toLocaleString('id-ID')}`);
    return ctx.scene.leave();
  }
);

/* -------------- bot setup ------------- */
const bot = new Telegraf<BotContext>(TELEGRAM_BOT_TOKEN);
const stage = new Scenes.Stage<BotContext>([addWizard]);

bot.use(session());         // mem‑bind ctx.session
bot.use(stage.middleware()); // mem‑bind ctx.wizard

bot.start((ctx) =>
  ctx.reply(
    'Halo! Gunakan /add untuk input, /summary untuk ringkasan, /categories untuk kategori.'
  )
);

bot.command('add', (ctx) => ctx.scene.enter('add-wizard'));

bot.command('categories', async (ctx) => {
  const names = await getCategories();
  ctx.reply(names.length ? names.join(', ') : 'Tidak ada kategori.');
});

bot.command('summary', async (ctx) => {
  const { total, perCat } = await monthlySummary();
  const msg =
    `📊 Total bulan ini: Rp ${format(total)}\n\n` +
    Object.entries(perCat)
      .map(([c, v]) => `${c}: Rp ${format(v)}`)
      .join('\n');
  ctx.reply(msg);
});

bot.launch();

/* ------------ helpers --------------- */
interface Parsed {
  title: string;
  date: string;
  category: string;
  amount: number;
}

async function addToNotion(p: Parsed) {
  await axios.post(
    'https://api.notion.com/v1/pages',
    {
      parent: { database_id: NOTION_DB_ID },
      properties: {
        Title: { title: [{ text: { content: p.title } }] },
        Date: { date: { start: p.date } },
        Category: { select: { name: p.category } },
        Amount: { number: p.amount },
      },
    },
    notionHeaders()
  );
}

async function getCategories(): Promise<string[]> {
  const { data } = await axios.get(
    `https://api.notion.com/v1/databases/${NOTION_DB_ID}`,
    notionHeaders()
  );
  return data.properties?.Category?.select?.options.map((o: any) => o.name) || [];
}

async function monthlySummary() {
  const start = dayjs().startOf('month').toISOString();
  const { data } = await axios.post(
    `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`,
    {
      filter: { and: [{ property: 'Date', date: { on_or_after: start } }] },
    },
    notionHeaders()
  );

  let total = 0;
  const per: Record<string, number> = {};
  for (const r of data.results) {
    const amt = r.properties?.Amount?.number || 0;
    const cat = r.properties?.Category?.select?.name || 'Other';
    total += amt;
    per[cat] = (per[cat] || 0) + amt;
  }
  return { total, perCat: per };
}

function notionHeaders() {
  return {
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
  } as const;
}
const format = (n: number) => n.toLocaleString('id-ID');