/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Glean Binary Path - Absolute path to glean binary. Leave empty to use PATH. All other settings are read from ~/.gleanrc.json. */
  "gleanPath": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `glean-url` command */
  export type GleanUrl = ExtensionPreferences & {}
  /** Preferences accessible in the `glean-url-form` command */
  export type GleanUrlForm = ExtensionPreferences & {}
  /** Preferences accessible in the `queue-status` command */
  export type QueueStatus = ExtensionPreferences & {}
  /** Preferences accessible in the `retry-jobs` command */
  export type RetryJobs = ExtensionPreferences & {}
  /** Preferences accessible in the `clear-jobs` command */
  export type ClearJobs = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `glean-url` command */
  export type GleanUrl = {
  /** URL (or leave empty for browser/clipboard) */
  "url": string
}
  /** Arguments passed to the `glean-url-form` command */
  export type GleanUrlForm = {}
  /** Arguments passed to the `queue-status` command */
  export type QueueStatus = {}
  /** Arguments passed to the `retry-jobs` command */
  export type RetryJobs = {}
  /** Arguments passed to the `clear-jobs` command */
  export type ClearJobs = {}
}

