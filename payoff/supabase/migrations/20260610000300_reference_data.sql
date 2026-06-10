-- ============================================================
-- Pay Off — reference data: earning rules + starter lessons
--
-- The ticket engine is data-driven: edge functions read these rows
-- at grant time. Change the economy here, not in code.
-- NOTE: requires_payment_to_app must remain false on every row —
-- the no_pay_to_play CHECK constraint and a unit test both enforce it.
-- ============================================================

insert into earning_rules
  (code, name, description, base_tickets, unit, unit_size,
   max_per_day, max_per_month, max_per_debt_per_month, max_tickets_per_month,
   once_per_debt, max_debts, config)
values
  ('debt_linked', 'Add a debt',
   'Link or add a debt to start tracking it. Once per debt, up to 5 debts.',
   5, 'event', null, null, null, null, null, true, 5, '{}'),

  ('on_time_payment', 'On-time payment',
   'Log an on-time payment toward a debt. Once per debt per month.',
   10, 'event', null, null, null, 1, null, false, null, '{}'),

  ('extra_payment', 'Extra payment',
   'Pay above your minimum: 1 ticket per $10 extra, up to 50 tickets per month.',
   1, 'dollars_extra', 10, null, null, null, 50, false, null, '{}'),

  ('milestone_25', '25% paid off',
   'Pay off a quarter of a debt. Once per debt.',
   100, 'event', null, null, null, null, null, true, null, '{"milestone_pct": 25}'),

  ('milestone_50', '50% paid off',
   'Halfway there. Once per debt.',
   150, 'event', null, null, null, null, null, true, null, '{"milestone_pct": 50}'),

  ('milestone_75', '75% paid off',
   'Three quarters down. Once per debt.',
   200, 'event', null, null, null, null, null, true, null, '{"milestone_pct": 75}'),

  ('milestone_100', 'Debt paid off!',
   'Pay a debt to zero. Once per debt.',
   500, 'event', null, null, null, null, null, true, null, '{"milestone_pct": 100}'),

  ('daily_lesson', 'Daily lesson',
   'Complete the daily money lesson. Once per day.',
   3, 'event', null, 1, null, null, null, false, null, '{}'),

  ('amoe', 'Free mail-in / web entry',
   'Alternate method of entry: free, no account activity required. Once per month.',
   5, 'event', null, null, 1, null, null, false, null, '{"public": true}'),

  ('streak_3mo', '3-month on-time streak',
   'Three consecutive months with every payment on time.',
   50, 'event', null, null, null, null, null, false, null, '{"streak_months": 3}');

insert into lessons (slug, title, body, sort) values
  ('avalanche-vs-snowball', 'Avalanche vs. snowball',
   'Two classic payoff orders: the avalanche targets your highest-APR debt first (saves the most interest), the snowball targets your smallest balance first (fastest wins, best for momentum). Either beats minimum-only. Pick the one you''ll actually stick with.', 1),
  ('what-apr-really-costs', 'What APR really costs',
   'A 24% APR card charges about 2% of your balance every month. On a $3,000 balance that''s ~$60/month just to stand still. Every extra dollar you pay goes straight at the principal — that''s the drain you see on your debt bar.', 2),
  ('minimums-are-a-trap', 'Minimum payments are designed to be slow',
   'Minimums are typically interest + ~1% of principal. Paying only the minimum on a $5,000 card at 22% APR can take 20+ years. Even $25 extra per month can cut that by more than half.', 3),
  ('due-dates-and-grace', 'Due dates, grace periods, and late fees',
   'Most cards have a grace period on new purchases only if you paid the prior statement in full. A payment is "on time" if it posts by the due date — schedule it 3 business days early to be safe.', 4),
  ('emergency-buffer', 'The $500 buffer rule',
   'Before going all-in on extra payments, park a small $500 buffer. It keeps one surprise bill from landing back on the card and undoing a month of progress.', 5);
