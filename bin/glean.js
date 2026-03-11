#!/usr/bin/env node

import { Command } from 'commander';
import { glean } from '../src/index.js';

const program = new Command();

program
  .name('glean')
  .description('Capture web articles as rich Obsidian notes with AI summaries')
  .version('1.0.0')
  .argument('<url>', 'URL of the article to glean')
  .option('--vault <name>', 'Target Obsidian vault')
  .option('--folder <path>', 'Folder within vault for notes')
  .option('--category <cat>', 'Override auto-detected category')
  .option('--tags <tags>', 'Additional tags (comma-separated)')
  .option('--open', 'Open the note in Obsidian after creation', false)
  .option('--update', 'Re-glean a previously saved URL', false)
  .option('--dry-run', 'Print the generated note without saving', false)
  .option('--json', 'Output structured data as JSON', false)
  .option('--model <model>', 'AI model to use for summarisation (haiku, sonnet, opus)')
  .option('--config <path>', 'Path to config file')
  .action(async (url, options) => {
    try {
      const result = await glean(url, options);
      if (!options.dryRun && !options.json) {
        const action = result.isUpdate ? 'Updated' : 'Created';
        console.log(`\u2713 ${action}: ${result.path}`);
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();
