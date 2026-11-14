// Player-facing wording for outcomes. Pure functions, no DOM.
import { VANGUARD } from './levels.js';

const KIND_FALLBACK = { derelict: 'a dead satellite', debris: 'a piece of space junk', satellite: 'another satellite' };

/** "Weather satellite" -> "a weather satellite", "Old TV satellite" -> "an old TV satellite". */
function withArticle(name) {
  const lower = /^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name;
  return `${/^[aeiou]/i.test(lower) ? 'an' : 'a'} ${lower}`;
}

/** Describe what the player hit, from a 'collision' event detail. */
export function describeCollision(detail = {}) {
  const name = detail.withName || '';
  const kind = detail.withKind || '';
  const isVanguard = name === VANGUARD;
  let phrase;
  if (isVanguard) phrase = 'Vanguard 1, a real satellite that has been silent since 1964';
  else if (!name) phrase = KIND_FALLBACK[kind] || 'something in orbit';
  else if (/^your satellite/i.test(name)) phrase = 'one of your own satellites';
  else if (/^[A-Z][a-z]+[A-Z]\w*\s+\d+$/.test(name) && kind === 'satellite') {
    // Made-up satellite names such as "SkyLink 5": keep the capitals, say what it is.
    const base = name.replace(/\s*\d+$/, '');
    phrase = `${/^[AEIOU]/.test(base) ? 'an' : 'a'} ${base} satellite`;
  } else if (/^\d|[A-Z].*\d/.test(name) && kind === 'satellite') phrase = withArticle(name.replace(/\s*\d+$/, ''));
  else phrase = withArticle(name);
  if (!isVanguard && kind === 'derelict' && !/old|dead/i.test(name)) phrase += ' (a dead satellite)';
  return { name, kind, phrase, isVanguard };
}

const HEADINGS = { crash: 'Not quite', lost: 'Not quite', collision: 'Collision!' };

/** Heading and one-line explanation for a failed launch. */
export function failureCopy(kind, detail) {
  if (kind === 'collision') {
    const c = describeCollision(detail);
    return { heading: HEADINGS.collision, line: `Your satellite hit ${c.phrase}.` };
  }
  if (kind === 'lost') {
    return { heading: HEADINGS.lost, line: 'Too fast. Your satellite flew off into deep space.' };
  }
  return {
    heading: HEADINGS.crash,
    line: 'Not enough speed, or the burn came too low. Your satellite fell back to Earth.',
  };
}
