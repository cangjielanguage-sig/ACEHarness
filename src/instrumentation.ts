export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { workflowManager } = await import('./lib/workflow-manager');
    await workflowManager.recoverFromCrash();
  }
}
