// Demo data seeder. Run AFTER migrations are applied:
//   npm run seed
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.
//
// Creates: 1 demo member (admin, so you can try the admin console),
// 2 debts, ~80 tickets in the open drawing, 1 open drawing, and
// 3 past winners visible in the winners feed.
//
// Idempotent-ish: safe to re-run; existing users are reused, but ledger
// rows and drawings are appended (the ledger is append-only by design).

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import "dotenv/config";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (see .env.example)");
  process.exit(1);
}

const db: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

const DEMO_EMAIL = "demo@payoff.test";
const DEMO_PASSWORD = "payoff-demo-123";

async function ensureUser(email: string, password: string): Promise<User> {
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!error && data.user) return data.user;

  // Already exists — find them.
  const { data: list, error: listErr } = await db.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) throw listErr;
  const existing = list.users.find((u) => u.email === email);
  if (!existing) throw error ?? new Error(`Could not create or find ${email}`);
  return existing;
}

async function ruleId(code: string): Promise<string> {
  const { data, error } = await db
    .from("earning_rules")
    .select("id")
    .eq("code", code)
    .single();
  if (error) throw error;
  return data.id;
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function monthsAgo(months: number, day = 5): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months, day);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log("Seeding Pay Off demo data…");

  // ---- demo member (admin so the admin console is reachable) ----
  const demo = await ensureUser(DEMO_EMAIL, DEMO_PASSWORD);
  await db
    .from("profiles")
    .update({
      first_name: "Demo",
      last_initial: "M",
      city: "Tulsa",
      is_admin: true,
      monthly_budget: 480,
    })
    .eq("id", demo.id);
  console.log(`  member: ${DEMO_EMAIL} / ${DEMO_PASSWORD} (admin)`);

  // ---- 2 debts ----
  const { data: debts, error: debtErr } = await db
    .from("debts")
    .insert([
      {
        member_id: demo.id,
        nickname: "The Visa",
        type: "credit_card",
        creditor_name: "Chase",
        current_balance: 4200,
        original_balance: 6000,
        apr: 22.9,
        minimum_payment: 105,
        due_day: 15,
        monthly_payment: 250,
      },
      {
        member_id: demo.id,
        nickname: "Corolla loan",
        type: "auto",
        creditor_name: "Toyota Financial",
        current_balance: 7800,
        original_balance: 14500,
        apr: 6.4,
        minimum_payment: 230,
        due_day: 3,
        monthly_payment: 230,
      },
    ])
    .select();
  if (debtErr) throw debtErr;
  const [visa, corolla] = debts;
  console.log("  debts: The Visa, Corolla loan");

  // ---- payment history (3-month on-time streak in the making) ----
  await db.from("payments").insert(
    [2, 1, 0].flatMap((m) => [
      { member_id: demo.id, debt_id: visa.id, amount: 250, paid_at: monthsAgo(m, 14), on_time: true },
      { member_id: demo.id, debt_id: corolla.id, amount: 230, paid_at: monthsAgo(m, 2), on_time: true },
    ]),
  );

  // ---- 1 open drawing (seed + commitment via trigger) ----
  const { data: openDrawing, error: drawErr } = await db
    .from("drawings")
    .insert({
      name: "June Payoff Drop",
      prize_amount: 2500,
      sponsor_name: "Acme Credit Union",
      sponsor_blurb: "Acme CU believes every payoff journey deserves a tailwind.",
      opens_at: isoDaysFromNow(-7),
      closes_at: isoDaysFromNow(14),
    })
    .select()
    .single();
  if (drawErr) throw drawErr;
  console.log(`  open drawing: ${openDrawing.name} ($${openDrawing.prize_amount})`);

  // ---- ~80 tickets for the demo member, attached to the open drawing ----
  const rules = {
    debt_linked: await ruleId("debt_linked"),
    on_time_payment: await ruleId("on_time_payment"),
    extra_payment: await ruleId("extra_payment"),
    daily_lesson: await ruleId("daily_lesson"),
    amoe: await ruleId("amoe"),
  };
  const grants = [
    { rule_id: rules.debt_linked, qty: 5, metadata: { debt_id: visa.id } },
    { rule_id: rules.debt_linked, qty: 5, metadata: { debt_id: corolla.id } },
    { rule_id: rules.on_time_payment, qty: 10, metadata: { debt_id: visa.id } },
    { rule_id: rules.on_time_payment, qty: 10, metadata: { debt_id: corolla.id } },
    { rule_id: rules.extra_payment, qty: 14, metadata: { debt_id: visa.id, extra_amount: 145 } },
    { rule_id: rules.extra_payment, qty: 28, metadata: { debt_id: visa.id, extra_amount: 280 } },
    { rule_id: rules.daily_lesson, qty: 3, metadata: {} },
    { rule_id: rules.amoe, qty: 5, metadata: { amoe: true } },
  ];
  await db.from("ticket_ledger").insert(
    grants.map((g) => ({ ...g, member_id: demo.id, drawing_id: openDrawing.id })),
  );
  console.log(`  tickets: ${grants.reduce((s, g) => s + g.qty, 0)} in ${openDrawing.name}`);

  // ---- 3 past winners ----
  const pastWinners = [
    { email: "jess@payoff.test", first: "Jess", initial: "T", city: "Tulsa", debtType: "auto", prize: 1000, name: "March Payoff Drop", sponsor: "Sunrise Lending", monthsBack: 3 },
    { email: "marcus@payoff.test", first: "Marcus", initial: "W", city: "Detroit", debtType: "credit_card", prize: 2500, name: "April Payoff Drop", sponsor: "Acme Credit Union", monthsBack: 2 },
    { email: "ana@payoff.test", first: "Ana", initial: "R", city: "Phoenix", debtType: "student", prize: 1500, name: "May Payoff Drop", sponsor: "Brightpath Bank", monthsBack: 1 },
  ] as const;

  for (const w of pastWinners) {
    const user = await ensureUser(w.email, "payoff-demo-123");
    await db
      .from("profiles")
      .update({ first_name: w.first, last_initial: w.initial, city: w.city })
      .eq("id", user.id);

    const { data: drawing, error: dErr } = await db
      .from("drawings")
      .insert({
        name: w.name,
        prize_amount: w.prize,
        sponsor_name: w.sponsor,
        opens_at: isoDaysFromNow(-30 * (w.monthsBack + 1)),
        closes_at: isoDaysFromNow(-30 * w.monthsBack),
      })
      .select()
      .single();
    if (dErr) throw dErr;

    // One winning ticket entry, then walk the full lifecycle so the
    // transition triggers write a believable audit trail.
    const { data: ticket, error: tErr } = await db
      .from("ticket_ledger")
      .insert({
        member_id: user.id,
        rule_id: rules.amoe,
        qty: 5,
        drawing_id: drawing.id,
        metadata: { seeded: true },
      })
      .select()
      .single();
    if (tErr) throw tErr;

    await db.from("drawings").update({ status: "closed" }).eq("id", drawing.id);
    await db
      .from("drawings")
      .update({
        status: "drawn",
        drawn_at: isoDaysFromNow(-30 * w.monthsBack + 1),
        winning_ticket_id: ticket.id,
        rng_proof: { seeded_demo: true, total_tickets: 5, winning_index: 0 },
      })
      .eq("id", drawing.id);

    const { data: payout, error: pErr } = await db
      .from("payouts")
      .insert({
        drawing_id: drawing.id,
        member_id: user.id,
        amount: w.prize,
        debt_type: w.debtType,
      })
      .select()
      .single();
    if (pErr) throw pErr;

    await db.from("payouts").update({ status: "claimed", creditor_name: "Demo Creditor", account_reference: "•••• 1234" }).eq("id", payout.id);
    await db.from("payouts").update({ status: "payment_sent" }).eq("id", payout.id);
    await db.from("payouts").update({ status: "confirmed" }).eq("id", payout.id);
    console.log(`  past winner: ${w.first} ${w.initial}. · ${w.city} · $${w.prize}`);
  }

  console.log("Done. Sign in with demo@payoff.test / payoff-demo-123");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
