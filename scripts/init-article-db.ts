/**
 * Initialize Article Agent Database
 *
 * This script applies all migrations to the D1 database
 *
 * Usage:
 *   npx wrangler d1 execute NEWSNOW_DB --local --file=./migrations/0001_create_article_tables.sql
 *   OR
 *   npx wrangler d1 execute NEWSNOW_DB --remote --file=./migrations/0001_create_article_tables.sql
 */

import process from "node:process"
import fs from "node:fs"
import path from "node:path"

const migrationsDir = path.join(process.cwd(), "migrations")

console.log("📦 Article Agent Database Migration Guide")
console.log("=========================================\n")

// Read all migration files
const migrations = fs.readdirSync(migrationsDir)
  .filter(file => file.endsWith(".sql"))
  .sort()

if (migrations.length === 0) {
  console.log("❌ No migration files found in ./migrations/")
  process.exit(1)
}

console.log(`Found ${migrations.length} migration(s):\n`)

migrations.forEach((file, index) => {
  console.log(`  ${index + 1}. ${file}`)
})

console.log("\n📝 To apply migrations:\n")

console.log("For LOCAL development:")
migrations.forEach((file) => {
  console.log(`  npx wrangler d1 execute NEWSNOW_DB --local --file=./migrations/${file}`)
})

console.log("\nFor REMOTE (production):")
migrations.forEach((file) => {
  console.log(`  npx wrangler d1 execute NEWSNOW_DB --remote --file=./migrations/${file}`)
})

console.log("\n📊 To verify tables were created:")
console.log("  npx wrangler d1 execute NEWSNOW_DB --local --command=\"SELECT name FROM sqlite_master WHERE type='table'\"")

console.log("\n💡 Tip: Create some default collections to help the AI understand your interests:")
console.log("  Example collections:")
console.log("    - Rust Performance (Deep dives into memory management)")
console.log("    - AI & Machine Learning (Latest research and tutorials)")
console.log("    - Web Development (Modern frameworks and best practices)")

console.log("\n✨ Once migrations are complete, start the dev server:")
console.log("  npm run dev")
console.log("")
