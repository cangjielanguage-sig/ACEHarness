/**
 * Migration script: Add UUID step IDs to existing run state.yaml files
 * Run with: npx tsx scripts/migrate-step-ids.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { randomUUID } from 'crypto';

const runsDir = resolve(process.cwd(), 'runs');

function migrate() {
  const entries = readdirSync(runsDir).filter(e => e.startsWith('run-'));
  let migrated = 0;
  let skipped = 0;

  for (const entry of entries) {
    const stateFile = resolve(runsDir, entry, 'state.yaml');
    if (!existsSync(stateFile)) {
      skipped++;
      continue;
    }

    try {
      const content = readFileSync(stateFile, 'utf-8');
      const state = parse(content);

      if (!state.stepLogs || !Array.isArray(state.stepLogs)) {
        skipped++;
        continue;
      }

      let changed = false;
      for (const log of state.stepLogs) {
        if (!log.id) {
          log.id = randomUUID();
          changed = true;
        }
      }

      if (changed) {
        const yamlContent = '# Auto-generated run state\n' + stringify(state);
        writeFileSync(stateFile, yamlContent, 'utf-8');
        migrated++;
        console.log(`Migrated: ${entry} (${state.stepLogs.length} steps)`);
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`Error processing ${entry}:`, err);
    }
  }

  console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}`);
}

migrate();
