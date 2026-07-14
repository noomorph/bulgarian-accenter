'use strict';
/**
 * Corrects the misplaced stress marks in the raw rechnik.info dump, in place.
 *
 * 25 `name_stressed` cells carry a backtick on the wrong side of the vowel ("защитн`о"), which
 * would put an accent on a consonant. data/sql-corrections.json lists the 22 that are fixable;
 * the other 3 are genuinely ambiguous and stay as they are (the extractor drops their marks).
 *
 * Each correction only *moves a backtick* within one word — same letters, same byte length — so
 * this is a length-preserving substitution that cannot shift any offset in the file. It matches
 * the fully-quoted SQL literal ('защитн`о', quotes included) so it can only ever hit a whole
 * column value, never a word sitting inside a longer definition string.
 *
 *   node scripts/fix-stress-sql.js --dry-run     # report what would change
 *   node scripts/fix-stress-sql.js               # rewrite, keeping <dump>.bak
 */
const {
  createReadStream,
  createWriteStream,
  renameSync,
  copyFileSync,
  statSync,
  existsSync,
} = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
// Where `npm run dump` unpacks the upstream dump. Override with RECHNIK_SQL or --in.
const DEFAULT_SQL = join(root, '.cache', 'rechnik.db.sql');

function parseArgs(argv) {
  const args = { dryRun: false, in: process.env.RECHNIK_SQL || DEFAULT_SQL };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--in') args.in = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const corrections = require(join(root, 'data', 'sql-corrections.json'));

  if (!existsSync(args.in)) {
    process.stderr.write(`fix-stress-sql: no such file: ${args.in}\n`);
    process.exit(1);
  }

  // Match the whole quoted literal so we can only ever replace an entire column value.
  const patterns = corrections.map(({ from, to }) => {
    const needle = Buffer.from(`'${from}'`, 'utf8');
    const replacement = Buffer.from(`'${to}'`, 'utf8');
    if (needle.length !== replacement.length) {
      throw new Error(`correction changes length, refusing: ${from} -> ${to}`);
    }
    return { from, to, needle, replacement, hits: 0 };
  });

  const maxNeedle = Math.max(...patterns.map((p) => p.needle.length));
  const sizeBefore = statSync(args.in).size;
  const tmp = `${args.in}.tmp`;
  const out = args.dryRun ? null : createWriteStream(tmp);

  let carry = Buffer.alloc(0);

  /** Replace every occurrence in `buf`, in place (length-preserving). */
  function substitute(buf) {
    for (const p of patterns) {
      let at = 0;
      while ((at = buf.indexOf(p.needle, at)) !== -1) {
        p.replacement.copy(buf, at);
        p.hits++;
        at += p.replacement.length;
      }
    }
    return buf;
  }

  const stream = createReadStream(args.in, { highWaterMark: 4 << 20 });
  for await (const chunk of stream) {
    // A literal can straddle a chunk boundary, so keep the last (maxNeedle-1) bytes back.
    const pending = substitute(Buffer.concat([carry, chunk]));
    const keep = Math.min(maxNeedle - 1, pending.length);
    const flush = pending.subarray(0, pending.length - keep);
    carry = Buffer.from(pending.subarray(pending.length - keep));
    if (out && flush.length) out.write(flush);
  }
  if (out && carry.length) out.write(carry);

  if (out) {
    await new Promise((res, rej) => {
      out.on('error', rej);
      out.on('finish', res);
      out.end();
    });
  }

  let total = 0;
  for (const p of patterns) {
    total += p.hits;
    const flag = p.hits === 0 ? '  <-- NOT FOUND' : '';
    process.stderr.write(`  ${String(p.hits).padStart(3)}x  '${p.from}' -> '${p.to}'${flag}\n`);
  }
  process.stderr.write(`fix-stress-sql: ${total} replacements across ${patterns.length} corrections\n`);

  if (args.dryRun) {
    process.stderr.write('fix-stress-sql: dry run, nothing written\n');
    return;
  }

  const sizeAfter = statSync(tmp).size;
  if (sizeAfter !== sizeBefore) {
    throw new Error(`size changed (${sizeBefore} -> ${sizeAfter}); refusing to replace the dump`);
  }

  copyFileSync(args.in, `${args.in}.bak`);
  renameSync(tmp, args.in);
  process.stderr.write(`fix-stress-sql: wrote ${args.in} (original kept at ${args.in}.bak)\n`);
}

main().catch((err) => {
  process.stderr.write(`fix-stress-sql: ERROR ${err.message}\n`);
  process.exit(1);
});
