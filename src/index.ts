import { Agent } from './agent';

async function main() {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const userTask = process.argv[2] || "How do I create a new page in Notion?";

  const agent = new Agent(openaiApiKey, {
    maxSteps: 20,
    screenshotDir: 'dataset',
    slowMo: 500,
    viewportWidth: 1280,
    viewportHeight: 720,
    userDataDir: 'user-data-dir', // Persistent context - maintains auth between runs
  });

  await agent.execute(userTask);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

