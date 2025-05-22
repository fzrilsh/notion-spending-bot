// src/bot.ts
import 'dotenv/config';
import axios from 'axios';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { Telegraf, Scenes, session, Context } from 'telegraf';

dayjs.extend(customParseFormat);

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  NOTION_TOKEN: string;
  NOTION_DB_ID: string;
}
const { TELEGRAM_BOT_TOKEN, NOTION_TOKEN, NOTION_DB_ID } =
  process.env as NodeJS.ProcessEnv & Env;

if (!TELEGRAM_BOT_TOKEN) throw new Error('BOT token missing');

interface WizardState {
  payload: {
    title?: string;
    date?: string;
    category?: string;
    amount?: number;
  };
}
type BotContext = Context & Scenes.WizardContext<WizardState>;

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

const bot = new Telegraf<BotContext>(TELEGRAM_BOT_TOKEN);
const stage = new Scenes.Stage<BotContext>([addWizard]);

bot.use(session());         // mem‑bind ctx.session
bot.use(stage.middleware()); // mem‑bind ctx.wizard

bot.start((ctx) =>
  ctx.reply(
    'Halo! Gunakan /add untuk input, /summary untuk ringkasan, /categories untuk kategori.'
  )
);

bot.help((ctx) =>
  ctx.reply(
    `📘 *Panduan Penggunaan Bot*:\n\n` +
    `• /add — Tambah pengeluaran baru\n` +
    `• /categories — Lihat daftar kategori\n` +
    `• /summary — Ringkasan bulan ini\n` +
    `• /summary DD/MM-DD/MM — Ringkasan rentang tanggal tertentu\n` +
    `• /help — Tampilkan bantuan\n\n` +
    `📝 Contoh:\n` +
    `• /summary 01/05-10/05\n` +
    `• /add lalu ikuti instruksi pengisian\n`,
    { parse_mode: 'Markdown' }
  )
);

bot.command('add', (ctx) => ctx.scene.enter('add-wizard'));

bot.command('categories', async (ctx) => {
  const names = await getCategories();
  ctx.reply(names.length ? names.join(', ') : 'Tidak ada kategori.');
});

bot.command('summary', async (ctx) => {
  const text = ctx.message.text;
  const args = text.split(' ').slice(1);
  const detailFlag = args.includes('--detail');

  const rangeArg = args.find((arg) => arg.includes('-') && !arg.startsWith('--'));
  let start: string | undefined;
  let end: string | undefined;

  if (rangeArg) {
    const match = rangeArg.match(/^(\d{2}\/\d{2})-(\d{2}\/\d{2})$/);
    if (match) {
      const [_, from, to] = match;
      const year = dayjs().year(); // gunakan tahun saat ini
      start = dayjs(from, 'DD/MM').year(year).toISOString();
      end = dayjs(to, 'DD/MM').year(year).endOf('day').toISOString();
    } else {
      await ctx.reply('❌ Format salah. Gunakan `/summary DD/MM-DD/MM` atau tambahkan `--detail`');
      return;
    }
  }

  const { total, perCat, detail } = await monthlySummary(start, end);

  let msg =
    `📊 Total: Rp ${format(total)}\n\n` +
    Object.entries(perCat)
      .map(([c, v]) => `• ${c}: Rp ${format(v)}`)
      .join('\n');

  if (detailFlag && detail.length) {
    const grouped: Record<string, Parsed[]> = {};

    // Group by category
    for (const item of detail) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }

    msg += `\n\n📄 *Detail per Kategori:*\n`;

    for (const [category, items] of Object.entries(grouped)) {
      msg += `\n*${category}*:\n`;
      items
        .sort((a, b) => dayjs(b.date).unix() - dayjs(a.date).unix())
        .forEach((item) => {
          msg += `• ${dayjs(item.date).format('DD/MM HH:mm')} — *${item.title}*: Rp ${format(item.amount)}\n`;
        });
    }
  }

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.launch();

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

async function monthlySummary(startDate?: string, endDate?: string) {
  const start = startDate || dayjs().startOf('month').toISOString();
  const end = endDate || dayjs().endOf('month').toISOString();

  const { data } = await axios.post(
    `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`,
    {
      filter: {
        and: [
          { property: 'Date', date: { on_or_after: start } },
          { property: 'Date', date: { on_or_before: end } },
        ],
      },
    },
    notionHeaders()
  );

  let total = 0;
  const per: Record<string, number> = [];
  const detail: Parsed[] = [];

  for (const r of data.results) {
    const amt = r.properties?.Amount?.number || 0;
    const cat = r.properties?.Category?.select?.name || 'Other';
    const title = r.properties?.Title?.title?.[0]?.text?.content || '(untitled)';
    const date = r.properties?.Date?.date?.start || '';

    total += amt;
    per[cat] = (per[cat] || 0) + amt;
    detail.push({ title, date, category: cat, amount: amt });
  }

  return { total, perCat: per, detail };
}

async function summaryRange(from: string, to: string) {
  const { data } = await axios.post(
    `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`,
    {
      filter: {
        and: [
          { property: 'Date', date: { on_or_after: from } },
          { property: 'Date', date: { on_or_before: to } },
        ],
      },
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