/**
 * Rewrite every Traditional Chinese character already in the database as
 * Simplified.
 *
 * `lib/text/simplified.ts` converts what arrives from now on — Whisper's
 * output and the model's — but the rows written before that seam existed are
 * still Traditional, and the client reads those. This walks every text,
 * varchar and jsonb column in the schema, converts what needs it and leaves
 * everything else alone. Idempotent: a second run finds nothing, because
 * Simplified text converts to itself.
 *
 *   node --env-file=.env.local --dns-result-order=ipv4first \
 *     --conditions=react-server --import tsx scripts/simplify-existing.ts [--write]
 *
 * Without `--write` it only reports.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { hasTraditional, toSimplified } from "@/lib/text/simplified";

const WRITE = process.argv.includes("--write");

type Column = { table: string; column: string; type: string };

async function columns(): Promise<Column[]> {
  const rows = await db.execute<{ table_name: string; column_name: string; data_type: string }>(sql`
    select c.table_name, c.column_name, c.data_type
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public'
       and t.table_type = 'BASE TABLE'
       and c.data_type in ('text', 'character varying', 'jsonb')
     order by c.table_name, c.ordinal_position
  `);
  return (rows.rows ?? rows as unknown as typeof rows.rows).map((r) => ({
    table: r.table_name,
    column: r.column_name,
    type: r.data_type,
  }));
}

async function primaryKey(table: string): Promise<string | null> {
  const rows = await db.execute<{ column_name: string }>(sql`
    select a.attname as column_name
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = ${`public.${table}`}::regclass and i.indisprimary
  `);
  const list = (rows.rows ?? []) as { column_name: string }[];
  return list.length === 1 ? list[0].column_name : null;
}

async function main() {
  const all = await columns();
  const byTable = new Map<string, Column[]>();
  for (const c of all) {
    if (!byTable.has(c.table)) byTable.set(c.table, []);
    byTable.get(c.table)!.push(c);
  }

  let touched = 0;
  let scanned = 0;

  for (const [table, cols] of byTable) {
    const pk = await primaryKey(table);
    if (!pk) {
      console.log(`skip ${table}: no single-column primary key`);
      continue;
    }

    for (const col of cols) {
      if (col.column === pk) continue;
      const ident = sql.raw(`"${table}"."${col.column}"`);
      const pkIdent = sql.raw(`"${pk}"`);
      const tbl = sql.raw(`"${table}"`);

      const rows = await db.execute(sql`
        select ${pkIdent} as id, ${ident}::text as value
          from ${tbl}
         where ${ident} is not null
      `);
      const list = ((rows as { rows?: unknown[] }).rows ?? []) as { id: string; value: string }[];
      scanned += list.length;

      for (const row of list) {
        if (!hasTraditional(row.value)) continue;
        const next = toSimplified(row.value);
        if (next === row.value) continue;
        touched += 1;
        console.log(`${table}.${col.column} ${row.id}: ${row.value.slice(0, 60)} -> ${next.slice(0, 60)}`);
        if (!WRITE) continue;
        if (col.type === "jsonb") {
          await db.execute(sql`update ${tbl} set ${sql.raw(`"${col.column}"`)} = ${next}::jsonb where ${pkIdent} = ${row.id}`);
        } else {
          await db.execute(sql`update ${tbl} set ${sql.raw(`"${col.column}"`)} = ${next} where ${pkIdent} = ${row.id}`);
        }
      }
    }
  }

  console.log(`\n${scanned} values read, ${touched} Traditional${WRITE ? " rewritten" : " found (dry run; pass --write)"}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
