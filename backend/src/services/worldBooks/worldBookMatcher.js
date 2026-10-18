// Chat-runtime world book matching. Trigger rules live in
// domain/worldBooks/entryRules.js so this path and the read-only preview cannot
// diverge; the only runtime-specific behaviour here is rolling probability and
// picking a random inclusion-group winner.
import { clampNumber } from '../../utils/number.js';
import {
  entryGroupWeight,
  entryInclusionGroup,
  evaluatePrimaryKeys,
  evaluateSecondaryKeys,
  passesSelectiveLogic,
  readEntryField,
  readEntryFlag
} from '../../domain/worldBooks/entryRules.js';

export function normalizeWorldBookScanTexts(texts) {
  if (!Array.isArray(texts)) {
    return typeof texts === 'string' && texts.length > 0 ? [texts] : [];
  }
  const normalized = [];
  for (const text of texts) {
    if (typeof text === 'string' && text.length > 0) normalized.push(text);
  }
  return normalized;
}

export function matchesWorldBookEntry(entry, lowerText, rawText) {
  const primary = evaluatePrimaryKeys(entry, rawText, lowerText);
  if (!primary.hasKeys) return false;

  let hit = primary.hit;
  if (hit && readEntryFlag(entry, 'selective', 'selective')) {
    hit = passesSelectiveLogic(
      readEntryField(entry, 'selectiveLogic', 'selective_logic', 0),
      evaluateSecondaryKeys(entry, lowerText)
    );
  }
  if (hit && readEntryFlag(entry, 'useProbability', 'use_probability')) {
    hit = Math.random() * 100 < clampNumber(readEntryField(entry, 'probability', 'probability', 100), 0, 100, 100);
  }
  return hit;
}

/** Keep one winner per inclusion group, chosen by weighted random. */
export function pruneWorldBookInclusionGroups(entryById, matched, matchedIds) {
  const groups = new Map();
  for (const match of matched) {
    const source = entryById.get(match.id);
    const group = source ? entryInclusionGroup(source) : '';
    if (!group) continue;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(match);
  }
  for (const groupMatches of groups.values()) {
    if (groupMatches.length <= 1) continue;
    let totalWeight = 0;
    for (const match of groupMatches) totalWeight += entryGroupWeight(entryById.get(match.id));
    let roll = Math.random() * totalWeight;
    let winnerIndex = 0;
    for (let index = 0; index < groupMatches.length; index += 1) {
      roll -= entryGroupWeight(entryById.get(groupMatches[index].id));
      if (roll <= 0) {
        winnerIndex = index;
        break;
      }
    }
    for (let index = 0; index < groupMatches.length; index += 1) {
      if (index === winnerIndex) continue;
      const loser = groupMatches[index];
      const matchIndex = matched.indexOf(loser);
      if (matchIndex !== -1) matched.splice(matchIndex, 1);
      matchedIds.delete(loser.id);
    }
  }
}
