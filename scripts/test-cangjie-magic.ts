/**
 * CangjieMagic 集成测试脚本
 *
 * 测试内容：
 * 1. cangjie-env: 环境检测、envsetup.sh sourcing、cjpm 可用性
 * 2. CangjieMagic MCP Server: 启动、initialize、tools/list、tools/call
 * 3. MCP config 生成（Feature 1 验证）
 *
 * 运行: npx tsx scripts/test-cangjie-magic.ts
 */

import { detectCangjieHome, buildCangjieSpawnEnv, isCjpmAvailable, buildCjpmShellCommand } from '../src/lib/cangjie-env';
import { CangjieMagicEngine } from '../src/lib/engines/cangjie-magic';
import { CangjieMagicEngineWrapper } from '../src/lib/engines/cangjie-magic-wrapper';
import { writeFile, unlink } from 'fs/promises';
import { resolve } from 'path';
import { tmpdir } from 'os';

const CANGJIE_MAGIC_DIR = '/Users/sundaiyue/Documents/ace/CangjieMagic';
const MCP_SERVER_CMD = 'cjpm run --name magic.examples.mcp_server';

async function test(name: string, fn: () => Promise<void>) {
  process.stdout.write(`\n🧪 ${name} ... `);
  try {
    await fn();
    console.log('✅ PASS');
  } catch (err: any) {
    console.log('❌ FAIL');
    console.error(`   ${err.message || err}`);
  }
}

async function main() {
  console.log('=== CangjieMagic 集成测试 ===\n');

  // --- Test 1: detectCangjieHome ---
  let cangjieHome: string | null = null;
  await test('detectCangjieHome()', async () => {
    // Set env for detection since env-vars.yaml doesn't exist
    process.env.CANGJIE_HOME = '/Users/sundaiyue/cangjie';
    cangjieHome = await detectCangjieHome();
    if (!cangjieHome) throw new Error('CANGJIE_HOME not detected');
    console.log(`\n   CANGJIE_HOME = ${cangjieHome}`);
  });

  if (!cangjieHome) {
    console.error('\n⛔ CANGJIE_HOME not found, cannot continue tests.');
    process.exit(1);
  }

  // --- Test 2: buildCangjieSpawnEnv ---
  let spawnEnv: Record<string, string> = {};
  await test('buildCangjieSpawnEnv()', async () => {
    spawnEnv = await buildCangjieSpawnEnv(cangjieHome!);
    // Check key env vars that envsetup.sh should set
    const hasPath = spawnEnv.PATH?.includes('cangjie');
    const hasDyld = spawnEnv.DYLD_LIBRARY_PATH || spawnEnv.LD_LIBRARY_PATH;
    console.log(`\n   PATH includes cangjie: ${hasPath}`);
    console.log(`   DYLD_LIBRARY_PATH: ${(spawnEnv.DYLD_LIBRARY_PATH || '').slice(0, 100)}...`);
    if (!hasPath) throw new Error('PATH does not include cangjie after sourcing envsetup.sh');
  });

  // --- Test 3: isCjpmAvailable ---
  await test('isCjpmAvailable()', async () => {
    const available = isCjpmAvailable(spawnEnv);
    if (!available) throw new Error('cjpm not available in sourced env');
    console.log(`\n   cjpm is available: ${available}`);
  });

  // --- Test 4: buildCjpmShellCommand ---
  await test('buildCjpmShellCommand()', async () => {
    const { command, args } = await buildCjpmShellCommand(cangjieHome!, MCP_SERVER_CMD, CANGJIE_MAGIC_DIR);
    console.log(`\n   command: ${command}`);
    console.log(`   args: ${args.join(' ')}`);
    if (command !== '/bin/bash') throw new Error(`Expected /bin/bash, got ${command}`);
    const fullCmd = args[args.length - 1];
    if (!fullCmd.includes('envsetup.sh')) throw new Error('Missing envsetup.sh in command');
    if (!fullCmd.includes('cjpm run')) throw new Error('Missing cjpm run in command');
  });

  // --- Test 5: MCP config generation (Feature 1) ---
  await test('MCP config JSON generation', async () => {
    const { command: shellCmd, args: shellArgs } = await buildCjpmShellCommand(
      cangjieHome!, MCP_SERVER_CMD, CANGJIE_MAGIC_DIR,
    );
    const mcpConfig = {
      mcpServers: {
        'cangjie-magic-test': {
          command: shellCmd,
          args: shellArgs,
          env: { CANGJIE_HOME: cangjieHome! },
        },
      },
    };
    const tmpFile = resolve(tmpdir(), 'test-mcp-config.json');
    await writeFile(tmpFile, JSON.stringify(mcpConfig, null, 2), 'utf-8');
    console.log(`\n   MCP config written to: ${tmpFile}`);
    console.log(`   Content: ${JSON.stringify(mcpConfig, null, 2).slice(0, 200)}...`);
    await unlink(tmpFile);
  });

  // --- Test 6: CangjieMagicEngine — start MCP server, initialize, list tools ---
  await test('CangjieMagicEngine start + tools/list', async () => {
    const engine = new CangjieMagicEngine({
      projectDir: CANGJIE_MAGIC_DIR,
      command: MCP_SERVER_CMD,
      cangjieHome: cangjieHome!,
    });

    engine.on('log', (msg: string) => {
      console.log(`\n   [log] ${msg}`);
    });

    try {
      await engine.start();
      const tools = engine.getTools();
      console.log(`\n   Tools found: ${tools.length}`);
      for (const t of tools) {
        console.log(`   - ${t.name}: ${t.description || '(no description)'}`);
      }
      if (tools.length === 0) throw new Error('No tools returned from MCP server');
    } finally {
      engine.stop();
    }
  });

  // --- Test 7: CangjieMagicEngine — call a tool (e.g. calculator add) ---
  await test('CangjieMagicEngine tools/call (calculator)', async () => {
    const engine = new CangjieMagicEngine({
      projectDir: CANGJIE_MAGIC_DIR,
      command: MCP_SERVER_CMD,
      cangjieHome: cangjieHome!,
    });

    engine.on('log', (msg: string) => {
      console.log(`\n   [log] ${msg}`);
    });

    try {
      await engine.start();
      const tools = engine.getTools();

      // Try to find an add/calculator tool
      const addTool = tools.find(t =>
        t.name.toLowerCase().includes('add') ||
        t.name.toLowerCase().includes('calc') ||
        t.name.toLowerCase().includes('sum')
      );

      if (addTool) {
        console.log(`\n   Calling tool: ${addTool.name}`);
        const result = await engine.callTool(addTool.name, { a: 23, b: 24 });
        console.log(`   Result: ${JSON.stringify(result)}`);
      } else {
        // Just call the first tool with a test prompt
        const firstTool = tools[0];
        console.log(`\n   No calculator tool found, calling first tool: ${firstTool.name}`);
        const result = await engine.callTool(firstTool.name, { prompt: '23 + 24 等于多少？' });
        console.log(`   Result: ${JSON.stringify(result).slice(0, 300)}`);
      }
    } finally {
      engine.stop();
    }
  });

  // --- Test 8: CangjieMagicEngineWrapper.isAvailable() ---
  await test('CangjieMagicEngineWrapper.isAvailable()', async () => {
    const wrapper = new CangjieMagicEngineWrapper();
    const available = await wrapper.isAvailable();
    console.log(`\n   isAvailable: ${available}`);
    if (!available) throw new Error('CangjieMagicEngineWrapper reports not available');
  });

  console.log('\n\n=== 测试完成 ===\n');
}

main().catch((err) => {
  console.error('\n💥 Unexpected error:', err);
  process.exit(1);
});
