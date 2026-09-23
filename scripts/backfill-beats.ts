/**
 * File the topics that predate automatic classification.
 *
 * Every topic created before `guessBeat` existed has `category: null`, so the
 * beats panel counted zero for every beat and filtering to one emptied the
 * board. This walks them once and applies the rule new topics now get on
 * create. Anything it does not recognise stays unfiled, which the panel shows
 * as its own row rather than hiding.
 *
 * Safe to run again: it only touches rows whose category is still null.
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/backfill-beats.ts
 */
import { eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { topics } from "@/lib/db/schema/research";
import { guessBeat } from "@/lib/research/service";

async function main() {
  const rows = await db.select().from(topics).where(isNull(topics.category));
  let filed = 0;

  for (const row of rows) {
    const beat = guessBeat(`${row.name} ${row.query}`);
    if (!beat) {
      console.log(`  unfiled   ${row.name}`);
      continue;
    }
    await db.update(topics).set({ category: beat }).where(eq(topics.id, row.id));
    filed++;
    console.log(`  ${beat.padEnd(9)} ${row.name}`);
  }

  console.log(`\n${filed} of ${rows.length} filed.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
