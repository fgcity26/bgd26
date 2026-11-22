import { config as loadEnv } from "dotenv";
import { Client } from "pg";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");

const c = new Client({ connectionString: url });
await c.connect();

const customer = (
  await c.query('select "id" from customers where "mobileNormalized" = $1', [
    "+8800000000000",
  ])
).rows[0].id;
const period = (await c.query('select "id" from fiscal_periods limit 1')).rows[0].id;
const accounts = (await c.query('select "id" from accounts order by "code" limit 2')).rows;

const results = [];

async function scenario(name, statements, shouldFail) {
  try {
    await c.query("begin");
    for (const [sql, params = []] of statements) await c.query(sql, params);
    await c.query("commit");
    results.push([name, shouldFail ? "FAIL (was allowed)" : "ok"]);
  } catch (error) {
    await c.query("rollback").catch(() => {});
    const detail = `${error.code}: ${error.message.split("\n")[0]}`;
    results.push([name, shouldFail ? `ok (${detail})` : `FAIL (${detail})`]);
  }
}

const orderSql = (id, number, mobile, grand, paid, due, walkIn = false) => [
  `insert into orders ("id","orderNumber","channel","customerId","recipientName","recipientMobile","subtotal","grandTotal","paidAmount","dueAmount"${walkIn ? ',"isWalkInCash","paymentStatus"' : ""},"updatedAt")
   values ($1,$2,'POS',$3,'X',$4,$5,$5,$6,$7${walkIn ? ",true,'PAID'" : ""},now())`,
  [id, number, customer, mobile, grand, paid, due],
];

// 1. Order totals must add up.
await scenario("order totals mismatch rejected", [orderSql("t_bad", "T-BAD", "+8801700000001", 100, 0, 0)], true);
await scenario("consistent order accepted", [orderSql("t_ok", "T-OK", "+8801700000002", 100, 100, 0)], false);

// 2. WALK_IN_CASH cannot take a digital payment.
await scenario(
  "walk-in POS sale accepted",
  [orderSql("t_walk", "T-WALK", "+8801700000003", 100, 100, 0, true)],
  false,
);
await scenario(
  "walk-in digital payment rejected",
  [
    [
      `insert into payments ("id","paymentNumber","orderId","amount","method","provider","status","updatedAt")
       values ('t_pay','P-BAD','t_walk',100,'BKASH','BKASH','PAID',now())`,
    ],
  ],
  true,
);

// 3. Journals must balance when posted.
const journal = (id, number, debit, credit) => [
  [
    `insert into journal_entries ("id","entryNumber","entryDate","fiscalPeriodId","description")
     values ($1,$2,now(),$3,'test')`,
    [id, number, period],
  ],
  [
    `insert into journal_entry_lines ("id","journalEntryId","accountId","debit","credit","lineOrder")
     values ($1,$2,$3,$4,0,1),($5,$2,$6,0,$7,2)`,
    [`${id}_a`, id, accounts[0].id, debit, `${id}_b`, accounts[1].id, credit],
  ],
  [`update journal_entries set "status" = 'POSTED' where "id" = $1`, [id]],
];

await scenario("unbalanced posted journal rejected", journal("t_j1", "J-BAD", 100, 90), true);
await scenario("balanced posted journal accepted", journal("t_j2", "J-OK", 100, 100), false);

// 4. Posted journals are immutable.
await scenario(
  "posted journal edit rejected",
  [[`update journal_entries set "description" = 'changed' where "id" = 't_j2'`]],
  true,
);
await scenario(
  "posted journal delete rejected",
  [[`delete from journal_entries where "id" = 't_j2'`]],
  true,
);

// 5. Newsletter emails are stored lowercase.
await scenario(
  "uppercase newsletter email rejected",
  [
    [
      `insert into newsletter_subscribers ("id","email","updatedAt") values ('t_n1','Mixed@Example.com',now())`,
    ],
  ],
  true,
);
await scenario(
  "lowercase newsletter email accepted",
  [
    [
      `insert into newsletter_subscribers ("id","email","updatedAt") values ('t_n2','mixed@example.com',now())`,
    ],
  ],
  false,
);

console.log("\nInvariant verification");
console.log("=====================");
for (const [name, outcome] of results) console.log(`${outcome.padEnd(58)} ${name}`);

const failed = results.filter(([, outcome]) => outcome.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} checks behaved as expected`);

// Leave the database clean. Triggers are bypassed for teardown only.
await c.query("set session_replication_role = 'replica'");
await c.query(`delete from newsletter_subscribers where "id" in ('t_n1','t_n2')`);
await c.query(`delete from journal_entry_lines where "journalEntryId" in ('t_j1','t_j2')`);
await c.query(`delete from journal_entries where "id" in ('t_j1','t_j2')`);
await c.query(`delete from payments where "id" = 't_pay'`);
await c.query(`delete from orders where "id" in ('t_bad','t_ok','t_walk')`);
await c.query("set session_replication_role = 'origin'");

await c.end();
process.exitCode = failed === 0 ? 0 : 1;
