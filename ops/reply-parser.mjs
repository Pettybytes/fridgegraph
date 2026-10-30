/**
 * ops/reply-parser.mjs — D3: the deterministic text-reply parser.
 *
 * Bryan's rule (level-b-plan.md D3): text replies are parsed deterministically, never by a model.
 *   normalize: lowercase, straight apostrophes, punctuation to spaces, collapse whitespace
 *   match whole words or phrases only ("yesterday" is not yes, "nobody" is not no)
 *   precedence: transport phrase -> DECLINED/NO_TRANSPORT
 *               then no/n/nope/can't/cannot/busy -> DECLINED (+BUSY if "busy")
 *               then yes/y/yeah/yep/sure/ok/okay/"i can" -> ACCEPTED
 *               anything else -> UNPARSED, no state change
 *
 * This file is the single source of truth. ops/build-reply-timeout-workflow.mjs copies the region
 * between the markers verbatim into the n8n Code node, and ops/reply-parser.test.mjs asserts the
 * builder is still in sync — so the tested parser and the deployed parser cannot drift.
 */

// #region parser
function normalizeReplyText(text) {
  return String(text === null || text === undefined ? '' : text)
    .toLowerCase()
    // curly/typographic apostrophes become straight, then ALL punctuation separates words
    .replace(/[\u2018\u2019\u02bc\u0060\u00b4]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/'/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function containsPhrase(tokens, phrase) {
  const want = phrase.split(' ')
  for (let i = 0; i + want.length <= tokens.length; i++) {
    let hit = true
    for (let k = 0; k < want.length; k++) {
      if (tokens[i + k] !== want[k]) { hit = false; break }
    }
    if (hit) return true
  }
  return false
}

function parseReply(text) {
  const normalized = normalizeReplyText(text)
  const tokens = normalized ? normalized.split(' ') : []

  // 1. transport -- checked first, because "no car" also contains "no" and "can t drive" contains
  //    "can t". An unavailable ride is a decline, not an "I can't".
  const TRANSPORT = ['no car', 'don t have a car', 'no ride', 'can t drive']
  for (const p of TRANSPORT) {
    if (containsPhrase(tokens, p)) {
      return { decision: 'DECLINED', declineReason: 'NO_TRANSPORT', matched: p, normalized }
    }
  }

  // 2. plain decline
  const DECLINE = ['no', 'n', 'nope', 'can t', 'cannot', 'busy']
  for (const p of DECLINE) {
    if (containsPhrase(tokens, p)) {
      return {
        decision: 'DECLINED',
        declineReason: containsPhrase(tokens, 'busy') ? 'BUSY' : 'OTHER',
        matched: p,
        normalized,
      }
    }
  }

  // 3. acceptance
  const ACCEPT = ['yes', 'y', 'yeah', 'yep', 'sure', 'ok', 'okay', 'i can']
  for (const p of ACCEPT) {
    if (containsPhrase(tokens, p)) {
      return { decision: 'ACCEPTED', declineReason: null, matched: p, normalized }
    }
  }

  return { decision: 'UNPARSED', declineReason: null, matched: null, normalized }
}
// #endregion parser

export { normalizeReplyText, containsPhrase, parseReply }
