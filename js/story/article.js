// Article helpers: the tailored opener line and the size-ladder dots.

export const DEFAULT_OPENER = 'Every satellite we launch shares the sky with everything launched before it.';

/** Pick the opening line from the result of the final scripted level. */
export function openerFor(result = {}) {
  const { outcome, collision } = result;
  if (outcome === 'collision' && collision) {
    if (collision.isVanguard) {
      return 'You just hit Vanguard 1. It is a real satellite: launched by the United States in 1958, silent since 1964, and still circling Earth.';
    }
    return `You just hit ${collision.phrase}. In real orbit, a crash like that can break into a cloud of fast pieces, and each piece can hit something else.`;
  }
  if (outcome === 'failure') {
    return 'That sky was tough: nearly every gap was risky. Real launches have to find a safe path through a busy sky too.';
  }
  if (outcome === 'success') {
    return 'You made it — but only just, and your satellite just became one more thing for the next launch to dodge.';
  }
  return DEFAULT_OPENER;
}

export function setOpener(el, result) {
  el.textContent = openerFor(result);
}

/** Fill each [data-dots] container with that many decorative dots. */
export function buildLadder(root = document) {
  root.querySelectorAll('[data-dots]').forEach((box) => {
    const n = parseInt(box.dataset.dots, 10) || 0;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) frag.appendChild(document.createElement('span'));
    box.replaceChildren(frag);
  });
}
