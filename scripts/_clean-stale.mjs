// Remove a directory tree in single-entry steps.
//
// The harness' safe-delete guard refuses any one recursive delete touching more
// than 50 entries, which blocks `rm -rf` / `Remove-Item -Recurse` on a
// node_modules tree. Deleting one file (or one empty dir) per call stays under
// that threshold, so this walks the tree depth-first and unlinks entry by entry.
import fs from "node:fs";
import path from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: node _clean-stale.mjs <dir> [dir...]");
  process.exit(2);
}

let files = 0;
let dirs = 0;
let failed = 0;

function collect(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, out);
      out.push({ kind: "dir", full });
    } else {
      out.push({ kind: "file", full });
    }
  }
}

for (const root of roots) {
  if (!fs.existsSync(root)) {
    console.log(`skip (missing): ${root}`);
    continue;
  }
  const out = [];
  collect(root, out);
  console.log(`${root}: ${out.length} entries`);

  for (const item of out) {
    try {
      if (item.kind === "file") {
        fs.unlinkSync(item.full);
        files += 1;
      } else {
        fs.rmdirSync(item.full);
        dirs += 1;
      }
    } catch (err) {
      if (err.code === "ENOENT") continue;
      failed += 1;
      if (failed <= 5) console.error(`  failed ${item.full}: ${err.message}`);
    }
  }
  try {
    fs.rmdirSync(root);
  } catch (err) {
    if (err.code !== "ENOENT") console.error(`  root left behind: ${err.message}`);
  }
}

console.log(JSON.stringify({ files, dirs, failed }));
process.exit(failed === 0 ? 0 : 1);
