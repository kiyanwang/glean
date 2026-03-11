#!/usr/bin/env node

import { Command } from 'commander';
import { glean, gleanAsync } from '../src/index.js';

const program = new Command();

program
  .name('glean')
  .description('Capture web articles as rich Obsidian notes with AI summaries')
  .version('1.0.0');

// --- Main command: glean <url> ------------------------------------------------

program
  .argument('<url>', 'URL of the article to glean')
  .option('--vault <name>', 'Target Obsidian vault')
  .option('--vault-path <path>', 'Absolute path to vault directory')
  .option('--folder <path>', 'Folder within vault for notes')
  .option('--category <cat>', 'Override auto-detected category')
  .option('--tags <tags>', 'Additional tags (comma-separated)')
  .option('--open', 'Open the note in Obsidian after creation', false)
  .option('--update', 'Re-glean a previously saved URL', false)
  .option('--dry-run', 'Print the generated note without saving', false)
  .option('--json', 'Output structured data as JSON', false)
  .option('--model <model>', 'AI model for summarisation (haiku, sonnet, opus)')
  .option('--config <path>', 'Path to config file')
  .option('--sync', 'Run synchronously (wait for summarisation)', false)
  .action(async (url, options) => {
    try {
      // Use synchronous path for: --sync, --dry-run, --json.
      const forcedSync = options.sync || options.dryRun || options.json;

      if (forcedSync) {
        const result = await glean(url, options);
        if (!options.dryRun && !options.json) {
          const action = result.isUpdate ? 'Updated' : 'Created';
          console.log(`\u2713 ${action}: ${result.path}`);
        }
      } else {
        await gleanAsync(url, options);
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// --- Subcommand: glean status -------------------------------------------------

program
  .command('status')
  .description('Show the queue status')
  .argument('[job-id]', 'Show detail for a specific job')
  .option('--all', 'Show full job history', false)
  .action(async (jobId, options) => {
    const { showStatus } = await import('../src/commands/status.js');
    showStatus(jobId, options);
  });

// --- Subcommand: glean retry --------------------------------------------------

program
  .command('retry')
  .description('Retry failed job(s)')
  .argument('[job-id]', 'Retry a specific job (omit to retry all failed)')
  .action(async (jobId) => {
    const { spawnWorker } = await import('../src/index.js');
    const { retryJobs } = await import('../src/commands/retry.js');
    retryJobs(jobId, spawnWorker);
  });

// --- Subcommand: glean clear --------------------------------------------------

program
  .command('clear')
  .description('Clear completed and failed jobs from the queue')
  .option('--failed', 'Only clear failed jobs', false)
  .option('--all', 'Clear ALL jobs (including pending)', false)
  .action(async (options) => {
    const { clearHistory } = await import('../src/commands/clear.js');
    await clearHistory(options);
  });

program.parse();
