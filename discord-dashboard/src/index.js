'use strict';
const { config, validate } = require('./config');

const problems = validate();
if (problems.length) {
  console.error('\n❌ Configuration incomplète (copie .env.example vers .env puis remplis-le) :\n');
  for (const p of problems) console.error(`  • ${p}`);
  console.error('');
  process.exit(1);
}

const { openDatabase } = require('./db');
const { SettingsStore } = require('./settings');
const { createBot } = require('./bot/client');
const { startWebServer } = require('./web/server');

async function main() {
  const db = openDatabase(config.dbPath);
  const settings = new SettingsStore(db);
  const client = createBot({ db, settings, config });

  const server = await startWebServer({ client, db, settings, config });
  await client.login(config.token);

  const shutdown = async (signal) => {
    console.log(`\n${signal} reçu, arrêt en cours…`);
    server.close();
    client.stopScheduler?.();
    await client.destroy();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

main().catch((err) => {
  if (err?.code === 'TokenInvalid' || /disallowed intents/i.test(err?.message || '')) {
    console.error('\n❌ Connexion à Discord impossible :', err.message);
    console.error('   → Vérifie DISCORD_TOKEN, et active « Server Members Intent » + « Message Content Intent » dans le portail développeur (onglet Bot).\n');
  } else {
    console.error(err);
  }
  process.exit(1);
});
