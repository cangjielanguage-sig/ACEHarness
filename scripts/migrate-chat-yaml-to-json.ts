/**
 * 一次性迁移脚本：将 data/chat-sessions/*.yaml 转换为 *.json
 * 用法: node --require tsx/cjs scripts/migrate-chat-yaml-to-json.ts
 */
import { readdir, readFile, writeFile, rename } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';

const CHAT_DIR = resolve(process.cwd(), 'data', 'chat-sessions');

async function migrate() {
  const files = await readdir(CHAT_DIR);
  const yamlFiles = files.filter(f => f.endsWith('.yaml'));

  if (yamlFiles.length === 0) {
    console.log('No YAML files to migrate.');
    return;
  }

  console.log(`Found ${yamlFiles.length} YAML file(s) to migrate.`);

  for (const file of yamlFiles) {
    const yamlPath = resolve(CHAT_DIR, file);
    const jsonPath = resolve(CHAT_DIR, file.replace(/\.yaml$/, '.json'));
    try {
      const raw = await readFile(yamlPath, 'utf-8');
      const data = parse(raw);
      await writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
      // Move old file to .yaml.bak
      await rename(yamlPath, yamlPath + '.bak');
      console.log(`  ✓ ${file} → ${file.replace(/\.yaml$/, '.json')}`);
    } catch (e: any) {
      console.error(`  ✗ ${file}: ${e.message}`);
    }
  }

  console.log('Migration complete.');
}

migrate().catch(console.error);
