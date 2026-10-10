import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit, for migrations only: `npm run db:generate -w @sudoku-fight/server` writes the SQL for a change
 * in src/db/schema.ts into drizzle/ (commit it). No database connection needed; the server applies pending
 * migrations when it starts (src/db/index.ts).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
