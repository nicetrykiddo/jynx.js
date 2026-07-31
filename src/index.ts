import { loadConfig, ConfigurationError } from './config.js';
import { createLogger } from './core/logger.js';
import { createStorage, pingDatabase } from './storage/db.js';
import { Repository } from './storage/repository.js';
import { AuthService } from './core/auth.js';
import { createModelProvider } from './model/provider.js';
import { ConversationService } from './core/conversation.js';
import { CommandExecutor } from './agent/executor.js';
import { WebSearchService } from './agent/websearch.js';
import { IntrospectionService } from './agent/introspection.js';
import { IntentDetector } from './agent/intent.js';
import { AgentRunner } from './agent/runner.js';
import { createBot } from './telegram/bot.js';
import { startWebhook } from './telegram/webhook.js';
import { ComputeService } from './agent/compute.js';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(config);
  logger.info('starting jynx');

  const storage = createStorage(config, logger);

  try {
    await pingDatabase(storage.pool);
    logger.info('database connection ok');
  } catch (error) {
    logger.error({ err: error }, 'database connection failed');
    process.exit(1);
  }

  const repository = new Repository(storage.db);
  const abandoned = await repository.failAbandonedTasks('interrupted by process restart');
  if (abandoned > 0) logger.warn({ count: abandoned }, 'recovered abandoned tasks');
  const auth = new AuthService(config);
  const model = createModelProvider(config, logger);
  const webSearch = new WebSearchService(config, logger);
  const introspection = new IntrospectionService({ config, repository, logger });
  const compute = new ComputeService(model, logger);
  const conversation = new ConversationService(
    config,
    repository,
    model,
    webSearch,
    introspection,
    compute,
  );

  const executor = new CommandExecutor(
    {
      allowedCommands: config.AGENT_ALLOWED_COMMANDS,
      timeoutMs: config.AGENT_COMMAND_TIMEOUT_MS,
      workdir: config.AGENT_WORKDIR,
    },
    logger,
  );
  executor.cleanupAbandonedRuns();
  const intent = new IntentDetector(model);
  const agentRunner = new AgentRunner(
    config,
    repository,
    model,
    executor,
    logger,
    webSearch,
    introspection,
    undefined,
    async (request) => {
      await writeFile(path.resolve('.deploy-request'), `${JSON.stringify(request)}\n`, {
        mode: 0o600,
      });
    },
  );

  const bot = createBot({
    config,
    logger,
    auth,
    conversation,
    repository,
    intent,
    agentRunner,
  });

  await bot.init();
  logger.info({ username: bot.botInfo.username }, 'bot initialized');

  const webhook = await startWebhook(bot, config, logger);

  const stop = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await webhook.close();
    await storage.close();
    process.exit(0);
  };

  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
