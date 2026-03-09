/**
 * Kiro CLI Engine Test
 *
 * Basic test to verify Kiro CLI integration
 */

import { KiroCliEngine } from './kiro-cli';

async function testKiroCli() {
  console.log('🚀 Starting Kiro CLI test...\n');

  const engine = new KiroCliEngine({
    workingDirectory: process.cwd(),
    agentName: 'kiro_default', // Use default agent
  });

  // Listen to events
  engine.on('initialized', (result) => {
    console.log('✅ Initialized:', JSON.stringify(result, null, 2));
  });

  engine.on('session-created', (data) => {
    console.log('✅ Session created:', data.sessionId);
  });

  engine.on('agent-message', (content) => {
    if (content.type === 'text') {
      process.stdout.write(content.text);
    }
  });

  engine.on('tool-call', (toolCall) => {
    console.log(`\n🔧 Tool call: ${toolCall.title} (${toolCall.status})`);
  });

  engine.on('tool-call-update', (update) => {
    console.log(`🔧 Tool update: ${update.title} (${update.status})`);
  });

  engine.on('log', (log) => {
    console.log('📝 Log:', log);
  });

  engine.on('error', (error) => {
    console.error('❌ Error:', error);
  });

  engine.on('exit', ({ code, signal }) => {
    console.log(`\n👋 Process exited with code ${code}, signal ${signal}`);
  });

  try {
    // Start the engine
    await engine.start();
    console.log('✅ Engine started\n');

    // Create a session
    const sessionId = await engine.createSession();
    console.log(`✅ Session ID: ${sessionId}\n`);

    // Send a simple prompt
    console.log('📤 Sending prompt: "Hello, can you help me?"\n');
    const stopReason = await engine.sendPrompt('Hello, can you help me?');
    console.log(`\n✅ Completed with stop reason: ${stopReason}`);

    // Stop the engine
    engine.stop();
    console.log('\n✅ Test completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    engine.stop();
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testKiroCli().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { testKiroCli };
