# Glean - Article Curation & Summarisation Tool

## Specification v1.0

---

## 1. Overview

Glean is a CLI productivity tool that captures web articles, generates structured AI summaries, and stores them as rich Obsidian notes with a searchable Base view. It transforms a URL into a fully catalogued knowledge entry in a single command.

### Workflow

```
URL → defuddle (parse & extract) → Claude (summarise) → Obsidian (store & index)
```

---

## 2. Recommendation: Node.js Script

### Decision: **Node.js**

| Factor | Bash | Node.js |
|--------|------|---------|
| JSON parsing | Requires `jq`, fragile | Native, robust |
| Template rendering | String concatenation, error-prone | Template literals, clean |
| Error handling | Exit codes only | try/catch, structured errors |
| defuddle integration | CLI subprocess only | Can use as library (`import defuddle`) |
| Claude integration | CLI subprocess or `curl` | Can use `claude` CLI via `execSync`, or Anthropic SDK |
| YAML generation | Manual string building | `yaml` package, guaranteed valid output |
| Maintainability | Hard to extend | Easy to add features, test, refactor |
| Dependencies | Fewer, but fragile glue | More, but well-managed via `package.json` |

**Rationale:** The tool orchestrates JSON data between three systems (defuddle, Claude, Obsidian). Node.js handles JSON natively, can import defuddle as a library for tighter integration, and produces reliable YAML frontmatter. The Claude CLI (`claude -p --model sonnet`) provides a zero-config way to call Claude without managing API keys separately.

---

## 3. System Requirements

| Dependency | Purpose | Installation |
|------------|---------|--------------|
| Node.js >= 22 | Runtime | Already installed |
| defuddle | Web content extraction | `npm install -g defuddle` (installed) |
| Claude CLI | AI summarisation | Already installed (`claude` v2.1.72) |
| Obsidian CLI | Note creation & vault management | Obsidian >= 1.12 with CLI enabled |
| Obsidian app | Must be running for CLI commands | `/Applications/Obsidian.app` |

---

## 4. CLI Interface

### Basic Usage

```bash
glean <url>
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--vault <name>` | Target Obsidian vault | Configurable default |
| `--folder <path>` | Folder within vault for notes | `Glean` |
| `--category <cat>` | Override auto-detected category | Auto-detected |
| `--tags <t1,t2>` | Additional tags (comma-separated) | None |
| `--open` | Open the note in Obsidian after creation | `false` |
| `--update` | Re-glean a previously saved URL (update existing note) | `false` |
| `--dry-run` | Print the generated note without saving | `false` |
| `--json` | Output the structured data as JSON | `false` |
| `--config` | Path to config file | `~/.gleanrc.json` |

### Examples

```bash
# Basic usage
glean https://martinfowler.com/articles/platform-prerequisites.html

# With options
glean https://example.com/article --vault "Knowledge Base" --category ai --tags "llm,agents" --open

# Re-glean an article to refresh the summary
glean https://example.com/article --update

# Dry run to preview
glean https://example.com/article --dry-run
```

---

## 5. Pipeline Architecture

### Stage 1: Content Extraction (defuddle)

Invoke defuddle to parse the URL and extract structured content.

**Preferred method:** Import defuddle as a Node.js library for tighter integration and better error handling.

```javascript
import { JSDOM } from 'jsdom';
import { Defuddle } from 'defuddle/node';

const dom = await JSDOM.fromURL(url);
const result = await Defuddle(dom, url, { markdown: true });
```

**Fallback method:** Shell out to the CLI.

```bash
defuddle parse --json --markdown "<url>"
```

**Note:** The Node.js bundle requires `"type": "module"` in `package.json` and `jsdom` as a dependency. defuddle includes 11 site-specific extractors (GitHub, YouTube, Reddit, Hacker News, ChatGPT, Claude, etc.) that produce better results than generic parsing.

**defuddle JSON output schema (DefuddleResponse):**

```json
{
  "content": "string (markdown when markdown option enabled)",
  "title": "string",
  "description": "string",
  "domain": "string",
  "favicon": "string (URL)",
  "image": "string (URL)",
  "language": "string (BCP 47, e.g. 'en', 'en-US')",
  "metaTags": [
    {
      "name": "string | null",
      "property": "string | null",
      "content": "string"
    }
  ],
  "parseTime": "number (ms)",
  "published": "string (date or empty)",
  "author": "string",
  "site": "string",
  "schemaOrgData": "any (schema.org structured data)",
  "wordCount": "number",
  "extractorType": "string | undefined (e.g. 'github', 'youtube')"
}
```

**Configuration options for defuddle:**

| Option | Default | Description |
|--------|---------|-------------|
| `markdown` | `false` | Convert content to Markdown |
| `debug` | `false` | Enable debug logging |
| `removeExactSelectors` | `true` | Remove ads, social widgets |
| `removeHiddenElements` | `true` | Remove CSS-hidden elements |
| `removeImages` | `false` | Strip all images |
| `useAsync` | `true` | Allow async extractors (third-party API calls) |

**Error handling:**
- Invalid URL → clear error message
- 404 / unreachable → report and exit
- No extractable content → warn and exit
- SSL errors → retry with appropriate flags or report

### Stage 2: AI Summarisation (Claude)

Pass the extracted content to Claude Sonnet for structured summarisation.

**Two integration options are supported:**

#### Option A: Claude CLI (Recommended for v1 — zero-config)

Uses the locally installed Claude CLI. No API key management needed; leverages existing authentication.

```bash
echo "<prompt>" | claude -p --model sonnet --output-format json --json-schema '<schema>'
```

**Advantages:** No API key setup, uses existing Claude CLI auth, simpler code.
**Disadvantages:** Subprocess overhead, less control over retries/streaming.

#### Option B: Anthropic Node.js SDK (Recommended for production)

Uses `@anthropic-ai/sdk` with structured outputs and Zod schema validation for guaranteed schema conformance.

```javascript
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const ArticleSummarySchema = z.object({
  title: z.string(),
  author: z.string(),
  source: z.string(),
  published: z.string(),
  summary: z.string(),
  keyTakeaways: z.array(z.string()),
  topics: z.array(z.string()),
  category: z.enum([
    'engineering-management', 'tools-and-libraries', 'ai',
    'software-engineering', 'leadership', 'devops',
    'architecture', 'career', 'other'
  ]),
  readingTimeMinutes: z.number(),
  sentiment: z.enum([
    'informative', 'opinion', 'tutorial',
    'case-study', 'research', 'news'
  ])
});

const response = await client.messages.parse({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  system: systemPrompt,
  messages: [{ role: 'user', content: userPrompt }],
  output_config: { format: zodOutputFormat(ArticleSummarySchema) }
});

const summary = response.parsed_output; // Automatically parsed & validated
```

**Advantages:** Guaranteed valid JSON, automatic Zod validation, type safety, token usage tracking, retry logic.
**Disadvantages:** Requires `ANTHROPIC_API_KEY` environment variable.

#### Decision

Start with **Option A (Claude CLI)** for v1. The tool can be upgraded to Option B later if needed. The `summarise.js` module abstracts the integration, making the switch straightforward.

#### Cost Estimates (Option B / Anthropic SDK)

| Article Length | Input Tokens | Output Tokens | Cost (Sonnet) |
|---------------|-------------|--------------|---------------|
| Short (1K words) | ~1,800 | ~500 | ~$0.013 |
| Medium (3K words) | ~4,500 | ~600 | ~$0.023 |
| Long (5K words) | ~7,000 | ~700 | ~$0.032 |

1,000 articles ≈ $13–32 with Sonnet. Batch API available for 50% discount.

**Prompt template:**

```
You are a knowledge curator. Given the following article content, generate a structured summary.

Article URL: {url}
Article Title: {title}
Article Author: {author}
Publication Date: {published}
Source Site: {site}
Word Count: {wordCount}

--- Article Content ---
{content}
--- End Content ---

Generate a structured summary with the following fields:
- title: The article title (clean it up if needed)
- author: The author name(s)
- source: The publication or website name
- published: The publication date in YYYY-MM-DD format (or empty string if unknown)
- summary: A concise 2-3 paragraph summary of the article's main points
- keyTakeaways: 3-5 bullet points of the most important insights
- topics: 3-7 topic tags relevant to the content (lowercase, hyphenated)
- category: One of: engineering-management, tools-and-libraries, ai, software-engineering, leadership, devops, architecture, career, other
- readingTimeMinutes: Estimated reading time of the original article
- sentiment: One of: informative, opinion, tutorial, case-study, research, news
```

**JSON Schema for structured output:**

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string" },
    "author": { "type": "string" },
    "source": { "type": "string" },
    "published": { "type": "string" },
    "summary": { "type": "string" },
    "keyTakeaways": {
      "type": "array",
      "items": { "type": "string" }
    },
    "topics": {
      "type": "array",
      "items": { "type": "string" }
    },
    "category": {
      "type": "string",
      "enum": [
        "engineering-management",
        "tools-and-libraries",
        "ai",
        "software-engineering",
        "leadership",
        "devops",
        "architecture",
        "career",
        "other"
      ]
    },
    "readingTimeMinutes": { "type": "number" },
    "sentiment": {
      "type": "string",
      "enum": ["informative", "opinion", "tutorial", "case-study", "research", "news"]
    }
  },
  "required": [
    "title", "author", "source", "published", "summary",
    "keyTakeaways", "topics", "category", "readingTimeMinutes", "sentiment"
  ]
}
```

### Stage 3: Note Creation (Obsidian)

Generate a Markdown note with YAML frontmatter and store it in the vault.

**Two approaches available:**

#### Approach A: Direct file write (Recommended)

Write the Markdown file directly to the vault folder on disk. Obsidian auto-detects new files and indexes them immediately. This is the simplest and most reliable approach — the full note (frontmatter + body) is written atomically.

```javascript
import { writeFile } from 'fs/promises';
const notePath = `${vaultPath}/${folder}/${filename}.md`;
await writeFile(notePath, noteContent, 'utf-8');
```

**Advantages:** No dependency on Obsidian running, atomic write, full control over frontmatter format.

#### Approach B: Obsidian CLI

Use `obsidian create` to create the note, then `property:set` for each frontmatter property.

```bash
obsidian create vault="<vault>" path="<folder>/<filename>" content="<body>"
obsidian property:set vault="<vault>" file="<filename>" name=title value="<value>" type=text
obsidian property:set vault="<vault>" file="<filename>" name=published value="2026-03-11" type=date
# ... repeat for each property
```

**Note:** The `create` command has no inline frontmatter flag — properties must be set individually via `property:set`, or a template with predefined frontmatter can be used. This makes Approach A significantly simpler for notes with many properties.

**Advantages:** Uses official API, can open note after creation with `open` flag.

#### Decision

Use **Approach A (direct file write)** for note creation, with an optional `obsidian open` call afterwards if `--open` is passed. This avoids needing Obsidian to be running for the core workflow.

#### Vault Path Resolution

The tool needs to locate the vault folder on disk. Strategy:
1. Check config file for explicit `vaultPath`
2. Fall back to `~/Documents/<vault-name>` or other common locations
3. Use `obsidian files` to verify the vault exists (if Obsidian is running)

### Stage 4: Update / Re-glean

When `--update` is passed (or the tool detects an existing note for the same URL), the tool updates the note in place rather than creating a new one.

**Duplicate detection:**

The tool scans all Markdown files in the target folder for a matching `url` property in the YAML frontmatter. This is done by:
1. Globbing `<vaultPath>/<folder>/*.md`
2. Parsing the YAML frontmatter of each file
3. Comparing the `url` property against the incoming URL

For performance, a lightweight index can be maintained as a JSON file (`<vaultPath>/<folder>/.glean-index.json`) mapping URLs to filenames. This index is rebuilt if missing or stale.

**Update behaviour:**

| Field | Behaviour |
|-------|-----------|
| `title` | Updated to latest |
| `author` | Updated to latest |
| `source` | Updated to latest |
| `url` | Unchanged (this is the match key) |
| `published` | Updated if previously empty, otherwise preserved |
| `gleaned` | **Preserved** (original capture date) |
| `updated` | Set to today's date |
| `category` | Updated to latest |
| `sentiment` | Updated to latest |
| `reading_time` | Updated to latest |
| `word_count` | Updated to latest |
| `language` | Updated to latest |
| `topics` | Updated to latest |
| `tags` | **Merged** — new tags added, existing tags preserved (user may have added manual tags) |
| `key_takeaways` | Updated to latest |
| Note body | **Replaced** with fresh summary |

**Conflict handling:**

- If `--update` is passed but no existing note is found, create a new note (no error).
- If no `--update` flag but a note with the same URL exists, **prompt the user** to confirm the update (or use `--update` to skip the prompt).
- The original file is overwritten in place (same filename and path) to preserve Obsidian backlinks.

**Index file: `.glean-index.json`**

```json
{
  "https://martinfowler.com/articles/platform-prerequisites.html": {
    "filename": "Platform-Prerequisites-for-Self-Service.md",
    "gleaned": "2026-03-11",
    "updated": "2026-03-11"
  }
}
```

The index is updated on every create/update operation and is treated as a cache — if deleted, it is rebuilt from the folder contents on next run.

---

## 6. Document Structure

Each gleaned article becomes a Markdown note with the following structure:

### YAML Frontmatter (Properties)

```yaml
---
title: "Platform Prerequisites for Self-Service"
author: "Martin Fowler"
source: "martinfowler.com"
url: "https://martinfowler.com/articles/platform-prerequisites.html"
published: 2024-01-15
gleaned: 2026-03-11
updated: 2026-03-11
category: engineering-management
sentiment: informative
reading_time: 12
word_count: 3200
language: en
topics:
  - platform-engineering
  - developer-experience
  - self-service
tags:
  - glean
  - engineering-management
key_takeaways:
  - "Platform teams should focus on self-service capabilities"
  - "Documentation and golden paths reduce cognitive load"
  - "Measuring developer satisfaction is crucial"
---
```

### Property Definitions

| Property | Type | Description |
|----------|------|-------------|
| `title` | Text | Article title |
| `author` | Text | Author name(s) |
| `source` | Text | Publication or website name |
| `url` | Text | Original article URL |
| `published` | Date | Article publication date (`YYYY-MM-DD`) |
| `gleaned` | Date | Date the article was first captured |
| `updated` | Date | Date the note was last re-gleaned |
| `category` | Text | Content category (from fixed list) |
| `sentiment` | Text | Article type classification |
| `reading_time` | Number | Estimated reading time in minutes |
| `word_count` | Number | Word count of original article |
| `language` | Text | Article language (BCP 47, e.g. `en`) |
| `topics` | List | Topic tags (lowercase, hyphenated) |
| `tags` | Tags | Obsidian tags (always includes `glean`) |
| `key_takeaways` | List | Key insights as bullet points |

### Note Body

```markdown
## Summary

{AI-generated 2-3 paragraph summary}

## Key Takeaways

- {takeaway 1}
- {takeaway 2}
- {takeaway 3}
- {takeaway 4}

## Source

[{title}]({url}) by {author} on {source}
```

### File Naming Convention

Notes are saved with a sanitised title as the filename:

```
Glean/Platform-Prerequisites-for-Self-Service.md
```

Rules:
- Spaces replaced with hyphens
- Special characters removed
- Truncated to 80 characters max
- Duplicate names get a numeric suffix: `-2`, `-3`, etc.

---

## 7. Obsidian Base Schema

A `.base` file defines the searchable database view over all gleaned articles.

### File: `Glean/Glean.base`

```yaml
filters:
  - file.inFolder("Glean")

formulas:
  days_since_gleaned: (now() - gleaned) / "1d"
  days_since_published: (now() - published) / "1d"

properties:
  title:
    displayName: Title
  author:
    displayName: Author
  source:
    displayName: Source
  category:
    displayName: Category
  published:
    displayName: Published
  gleaned:
    displayName: Gleaned
  reading_time:
    displayName: "Read Time (min)"
  sentiment:
    displayName: Type
  topics:
    displayName: Topics
  url:
    displayName: URL
  word_count:
    displayName: Words

summaries:
  reading_time:
    - average(values)
  word_count:
    - sum(values)

views:
  - name: All Articles
    type: table
    order:
      - file.name
      - title
      - author
      - source
      - category
      - published
      - gleaned
      - reading_time
      - sentiment
      - topics

  - name: By Category
    type: table
    groupBy:
      property: category
      direction: ASC
    order:
      - file.name
      - title
      - author
      - source
      - published
      - reading_time

  - name: Recent
    type: table
    filters:
      - formula.days_since_gleaned <= 30
    order:
      - file.name
      - title
      - author
      - category
      - gleaned
      - reading_time
    limit: 50

  - name: Cards
    type: cards
    order:
      - file.name
      - title
      - author
      - source
      - category
      - summary
```

### Design Principles

- **Flat schema only** — Obsidian does not support nested YAML properties in its property editor. All properties are top-level.
- **Property names are vault-wide** — Once a property name is assigned a type (e.g. `reading_time` = number), that type applies everywhere in the vault. The names above are prefixed with context where needed to avoid collisions.
- **Date format** — Always `YYYY-MM-DD` to enable date arithmetic, sorting, and summary functions (earliest/latest/range) in Bases.
- **Tags are first-class** — The `tags` property renders as interactive tags in Obsidian. The `glean` tag is always included for easy filtering across the vault.
- **`file.inFolder()` for scoping** — Filters use `file.inFolder("Glean")` rather than exact path matching, so notes in subfolders are also included.

### View Descriptions

| View | Purpose |
|------|---------|
| **All Articles** | Master table of every gleaned article, sorted by date |
| **By Category** | Articles grouped by category for themed browsing |
| **Recent** | Articles gleaned in the last 30 days |
| **Cards** | Visual card gallery for browsing |

---

## 8. Configuration

### Config File: `~/.gleanrc.json`

```json
{
  "vault": "Knowledge Base",
  "vaultPath": "/Users/you/Documents/Knowledge Base",
  "folder": "Glean",
  "defaultTags": ["glean"],
  "model": "sonnet",
  "categories": [
    "engineering-management",
    "tools-and-libraries",
    "ai",
    "software-engineering",
    "leadership",
    "devops",
    "architecture",
    "career",
    "other"
  ]
}
```

---

## 9. Error Handling

| Error | Behaviour |
|-------|-----------|
| Invalid URL format | Exit with clear message |
| defuddle extraction fails | Exit with error, suggest checking URL |
| defuddle returns empty content | Exit with warning |
| Claude CLI not available | Exit with install instructions |
| Claude API error / timeout | Retry once, then exit with error |
| Obsidian not running | Attempt to launch, then retry |
| Obsidian vault not found | Exit with message listing available vaults |
| Duplicate note title (new URL) | Append numeric suffix |
| Duplicate URL detected (no --update) | Prompt user to confirm update |
| Network errors | Clear message with suggestion to retry |

---

## 10. Project Structure

```
glean/
├── package.json
├── vitest.config.js           # Vitest configuration
├── bin/
│   └── glean.js               # CLI entry point (#!/usr/bin/env node)
├── src/
│   ├── index.js               # Main orchestrator
│   ├── extract.js             # defuddle integration
│   ├── summarise.js           # Claude CLI integration
│   ├── note.js                # Markdown/YAML note generation
│   ├── store.js               # File writing, index management, update detection
│   ├── config.js              # Configuration loading
│   └── utils.js               # Filename sanitisation, URL validation, etc.
├── templates/
│   └── base.yaml              # Glean.base template
├── test/
│   ├── extract.test.js
│   ├── summarise.test.js
│   ├── note.test.js
│   ├── store.test.js
│   ├── update.test.js
│   ├── config.test.js
│   ├── utils.test.js
│   ├── index.test.js
│   └── fixtures/
│       ├── sample-defuddle-output.json
│       ├── sample-claude-response.json
│       ├── sample-note.md
│       └── sample-index.json
├── .gleanrc.json.example      # Example config
└── SPECIFICATION.md            # This file
```

### Dependencies

```json
{
  "type": "module",
  "dependencies": {
    "commander": "^13.0.0",
    "defuddle": "^0.12.0",
    "jsdom": "^26.0.0",
    "yaml": "^2.7.0",
    "slugify": "^1.6.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

**Note:** defuddle is imported as a library (not a global CLI dependency). Claude CLI is expected as a global system installation. If upgrading to the Anthropic SDK (Option B), add `@anthropic-ai/sdk` and `zod` to dependencies.

---

## 11. Execution Flow (Pseudocode)

```
1. Parse CLI arguments (url, flags)
2. Load config from ~/.gleanrc.json (with defaults)
3. Validate URL format

4. CHECK FOR EXISTING NOTE
   a. Load or rebuild .glean-index.json
   b. Look up URL in index
   c. If found and no --update flag: prompt user to confirm update
   d. If found: load existing note metadata (preserve gleaned date, merge tags)
   e. Set isUpdate = true/false

5. EXTRACT
   a. Run: defuddle parse --json --markdown "<url>"
   b. Parse JSON response
   c. Validate: content exists and is non-empty

6. SUMMARISE
   a. Build prompt from template + extracted data
   b. Run: echo "<prompt>" | claude -p --model sonnet --output-format json --json-schema '<schema>'
   c. Parse JSON response
   d. Validate: all required fields present

7. GENERATE NOTE
   a. Build YAML frontmatter from summary + metadata
      - If isUpdate: preserve gleaned date, merge tags, set updated date
      - If new: set gleaned = today, updated = today
   b. Build Markdown body (summary, key takeaways, source link)
   c. Generate sanitised filename from title (or reuse existing filename if update)
   d. Combine into complete Markdown document

8. STORE
   a. If --dry-run: print note to stdout and exit
   b. Resolve vault path from config (vaultPath field)
   c. Ensure target folder exists: <vaultPath>/<folder>/
   d. Write file: <vaultPath>/<folder>/<filename>.md
   e. Update .glean-index.json
   f. If --open: obsidian open vault="<vault>" file="<filename>"

9. Output: confirmation with note path (indicate "created" or "updated")
```

---

## 12. Testing Strategy

All modules are unit tested using **Vitest**. The test suite is designed to run without external dependencies (no network calls, no Obsidian, no Claude API) by mocking external boundaries.

### Test Runner & Configuration

```bash
npx vitest        # watch mode
npx vitest run    # single run (CI)
```

### Test Structure

```
test/
├── extract.test.js          # defuddle integration
├── summarise.test.js        # Claude CLI integration
├── note.test.js             # Markdown/YAML note generation
├── obsidian.test.js         # Obsidian file writing & index management
├── config.test.js           # Configuration loading & defaults
├── utils.test.js            # Filename sanitisation, URL validation
├── update.test.js           # Re-glean / update flow
├── index.test.js            # End-to-end orchestration (all stages mocked)
└── fixtures/
    ├── sample-defuddle-output.json
    ├── sample-claude-response.json
    ├── sample-note.md
    └── sample-index.json
```

### Module Test Coverage

#### `extract.test.js` — Content Extraction

| Test | Description |
|------|-------------|
| Parses valid defuddle JSON output | Verify all fields are mapped correctly |
| Handles missing optional fields | `author`, `published`, `language` may be empty |
| Rejects empty content | Throws when `content` is empty string |
| Rejects null/undefined response | Throws on defuddle failure |
| Validates URL format before extraction | Rejects malformed URLs |

#### `summarise.test.js` — Claude Integration

| Test | Description |
|------|-------------|
| Builds correct prompt from extracted data | Verify template interpolation |
| Parses valid Claude JSON response | All schema fields present and typed correctly |
| Handles Claude CLI errors | Timeout, non-zero exit code, stderr output |
| Validates response against schema | Rejects missing required fields |
| Truncates very long content | Articles exceeding token limits are truncated with notice |

#### `note.test.js` — Note Generation

| Test | Description |
|------|-------------|
| Generates valid YAML frontmatter | Parseable YAML with all properties |
| Renders Markdown body correctly | Summary, key takeaways, source link sections |
| Combines frontmatter + body into complete note | Valid Markdown file with `---` delimiters |
| Handles special characters in frontmatter values | Quotes, colons, newlines are escaped |
| Handles empty/missing optional fields | Graceful defaults for missing author, date, etc. |
| Sets `gleaned` and `updated` dates correctly | Both set to today for new notes |

#### `obsidian.test.js` — File Writing & Index

| Test | Description |
|------|-------------|
| Writes note to correct vault path | `<vaultPath>/<folder>/<filename>.md` |
| Creates target folder if missing | `mkdir -p` equivalent |
| Loads and parses .glean-index.json | Valid index returns URL→filename map |
| Rebuilds index from folder contents | Scans `.md` files, extracts `url` from frontmatter |
| Updates index after write | New entry added, existing entry updated |
| Handles missing/corrupt index file | Rebuilds gracefully |

#### `utils.test.js` — Utilities

| Test | Description |
|------|-------------|
| Sanitises filename from title | Spaces → hyphens, special chars removed |
| Truncates long filenames to 80 chars | Clean truncation at word boundary |
| Appends numeric suffix for duplicates | `-2`, `-3`, etc. |
| Validates URL format | Accepts http/https, rejects invalid |
| Normalises URLs for comparison | Trailing slashes, query params, fragments |

#### `update.test.js` — Re-glean / Update Flow

| Test | Description |
|------|-------------|
| Detects existing note by URL | Finds match in index |
| Preserves original `gleaned` date on update | Not overwritten |
| Sets `updated` to today on re-glean | New date applied |
| Merges tags (user tags preserved) | Existing manual tags kept, new tags added |
| Overwrites note body with fresh summary | Body replaced, frontmatter merged |
| Reuses existing filename on update | No rename, preserves Obsidian backlinks |
| Creates new note when URL not found with --update | Falls through to create |

#### `config.test.js` — Configuration

| Test | Description |
|------|-------------|
| Loads config from default path | `~/.gleanrc.json` |
| Loads config from custom path | `--config` flag |
| Applies defaults for missing fields | vault, folder, tags, model |
| Handles missing config file | Uses all defaults, no error |
| Validates vaultPath exists | Warns if directory not found |

#### `index.test.js` — Orchestration (Integration)

| Test | Description |
|------|-------------|
| Full create flow (happy path) | Extract → Summarise → Generate → Store |
| Full update flow (happy path) | Detect → Extract → Summarise → Merge → Store |
| Dry run outputs to stdout | No file written |
| JSON flag outputs structured data | Parseable JSON to stdout |
| Extraction failure halts pipeline | Clean error, no partial writes |
| Summarisation failure halts pipeline | Clean error, no partial writes |

### Mocking Strategy

| Dependency | Mock Approach |
|------------|---------------|
| defuddle | Mock the library import; return fixture JSON |
| Claude CLI | Mock `execSync`; return fixture JSON response |
| File system | Use Vitest's `vi.mock('fs/promises')` or `memfs` for in-memory fs |
| Obsidian CLI | Mock `execSync` for `obsidian open` calls |
| Date/time | Mock `Date.now()` for deterministic `gleaned`/`updated` dates |

### CI Integration

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

Coverage target: **90%+ line coverage** across all `src/` modules.

---

## 13. Future Enhancements (Out of Scope for v1)

- **Batch processing**: Accept multiple URLs from a file
- **Browser extension**: Send current tab URL to glean
- **Obsidian plugin**: Glean directly from within Obsidian
- **Custom prompt templates**: User-defined summarisation prompts
- **Content archiving**: Save a local copy of the full article content
- **Link graph**: Track related articles via shared topics
- **Export**: Generate weekly/monthly digests from gleaned articles
