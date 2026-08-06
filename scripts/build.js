const { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const output = join(root, "public");
const files = [
  "index.html",
  "dashboard.html",
  "welcome.html",
  "transparency.html",
  "catalog.html",
  "cart.html",
  "styles.css",
];
const directories = ["js", "assets"];

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of files) {
  const source = join(root, file);
  if (!existsSync(source)) {
    throw new Error(`Required build input is missing: ${file}`);
  }
  cpSync(source, join(output, file));
}

for (const directory of directories) {
  const source = join(root, directory);
  if (existsSync(source)) {
    cpSync(source, join(output, directory), { recursive: true });
  }
}

writeFileSync(join(output, ".nojekyll"), "");
console.log(`Built ${files.length} pages and static assets in public/`);
