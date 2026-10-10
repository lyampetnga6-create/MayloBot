'use strict';
/**
 * Petit planificateur : exécute des tâches périodiques sans jamais se chevaucher
 * ni faire tomber le bot si l'une d'elles échoue.
 */
function startScheduler(client, jobs) {
  const timers = [];
  for (const job of jobs) {
    let running = false;
    const run = async () => {
      if (running || !client.isReady()) return;
      running = true;
      try {
        await job.run(client);
      } catch (err) {
        console.error(`[tâche ${job.name}]`, err);
      } finally {
        running = false;
      }
    };
    const timer = setInterval(run, job.everyMs);
    timer.unref?.();
    timers.push(timer);
    // Premier passage peu après le démarrage (laisse le cache se remplir).
    const first = setTimeout(run, job.firstMs ?? 5000);
    first.unref?.();
    timers.push(first);
  }
  return () => timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
}

module.exports = { startScheduler };
