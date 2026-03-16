import { execSync } from 'child_process';

const MAX_TWEET_TEXT_LENGTH = 2000;

/**
 * Compose tweet text from a summary and URL.
 *
 * @param {string|undefined} tweetSummary - AI-generated tweet summary.
 * @param {string} url - Article URL.
 * @param {string} [title] - Article title (fallback if tweetSummary missing).
 * @returns {string} Tweet text ready for posting.
 */
export function composeTweet(tweetSummary, url, title) {
  let text = tweetSummary || title || '';

  if (text.length > MAX_TWEET_TEXT_LENGTH) {
    text = text.slice(0, MAX_TWEET_TEXT_LENGTH - 3) + '...';
  }

  return text ? `${text} ${url}` : url;
}

/**
 * Open the Twitter/X compose intent URL in the default browser.
 *
 * @param {string} tweetText - Pre-filled tweet text.
 */
export function openTweetIntent(tweetText) {
  const intentUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

  try {
    execSync(`open "${intentUrl}"`);
  } catch {
    console.error(`Could not open browser. Copy this URL to tweet:\n${intentUrl}`);
  }
}
