import { resolvePetCharacter } from '@process/pet/petTypes';

const LOAD_TIMEOUT = 3000;
const FADE_MS = 150;
const PET_STATES_BASE_PATH = '../pet-states';
let currentObject: HTMLObjectElement | null = document.getElementById('pet') as HTMLObjectElement;

/** Current character id; recolors every state SVG after it loads. */
let currentCharacterId = 'classic';

function getStateAssetPath(state: string): string {
  return `${PET_STATES_BASE_PATH}/${state}.svg`;
}

/**
 * Recolor a loaded SVG document in place. The object element loads the
 * original file:// SVG (fetch() cannot read file:// in the packaged app);
 * once loaded we walk the guest DOM and rewrite fill / stop-color attributes
 * that match the base palette. Classic keeps the file untouched.
 */
function recolorObject(obj: HTMLObjectElement | null): void {
  if (!obj) return;
  const { palette } = resolvePetCharacter(currentCharacterId);
  if (!palette || Object.keys(palette).length === 0) return;
  const doc = obj.contentDocument;
  if (!doc) return;
  const rewrite = (el: Element, attr: string): void => {
    const value = el.getAttribute(attr);
    if (value) {
      const next = palette[value.toLowerCase()] ?? palette[value];
      if (next && next !== value) el.setAttribute(attr, next);
    }
  };
  doc.querySelectorAll('[fill]').forEach((el) => rewrite(el, 'fill'));
  doc.querySelectorAll('[stop-color]').forEach((el) => rewrite(el, 'stop-color'));
  doc.querySelectorAll('[stroke]').forEach((el) => rewrite(el, 'stroke'));
}

function setupTransitions(_target: HTMLObjectElement | null): void {
  // Intentionally empty: eye tracking now writes SVG `transform` attributes on
  // the .idle-pupil / .idle-track wrappers (see onEyeMove below), which are
  // not affected by CSS `transition` — that property only animates CSS
  // transforms. Smoothing comes from the tick rate, not from CSS transitions.
}

/**
 * Load a new SVG state and cross-fade it over the previous one. The old object
 * is removed only after the fade completes, so there's no white flash between
 * states. If the new SVG fails to load within LOAD_TIMEOUT we bail out silently
 * and keep showing the previous state.
 *
 * A generation counter guards the rapid state-change race: only the newest
 * load may own the `#pet` id; an older generation's load event arriving late
 * must not strip the id from the current object (that race left the pet
 * invisible — a surviving object with no id gets none of the #pet styles).
 */
let loadGeneration = 0;

function loadSvg(state: string): void {
  const generation = ++loadGeneration;
  const newObj = document.createElement('object');
  newObj.type = 'image/svg+xml';
  newObj.id = 'pet';
  newObj.style.position = 'absolute';
  newObj.style.inset = '0';
  newObj.style.width = '100%';
  newObj.style.height = '100%';
  newObj.style.opacity = '0';
  newObj.style.transition = `opacity ${FADE_MS}ms ease-out`;

  let loaded = false;
  const timeout = setTimeout(() => {
    if (!loaded && generation === loadGeneration) {
      // Failed to load — keep the previous object in charge.
      newObj.remove();
    }
  }, LOAD_TIMEOUT);

  newObj.addEventListener('load', () => {
    loaded = true;
    clearTimeout(timeout);
    // A newer load superseded this one — drop this object entirely.
    if (generation !== loadGeneration) {
      newObj.remove();
      return;
    }
    setupTransitions(newObj);
    try {
      recolorObject(newObj);
    } catch {
      // Recolor is cosmetic — never let it break the state swap.
    }

    const oldObj = currentObject;
    // Clear the old id immediately so duplicate #pet selectors (from CSS and
    // setupTransitions' query) never see two elements at once during the fade.
    if (oldObj && oldObj !== newObj) oldObj.removeAttribute('id');
    newObj.id = 'pet';
    currentObject = newObj;

    // Trigger the fade on the next frame so the browser has painted the
    // initial opacity:0 state — otherwise the transition is skipped and the
    // swap is instant.
    requestAnimationFrame(() => {
      newObj.style.opacity = '1';
      if (oldObj && oldObj !== newObj) oldObj.style.opacity = '0';
    });

    // Remove the old object after the cross-fade completes. Keep a reference
    // via closure so we don't race with another state change in the meantime.
    if (oldObj && oldObj !== newObj) {
      setTimeout(() => {
        oldObj.remove();
      }, FADE_MS);
    }
  });

  document.body.appendChild(newObj);

  // Direct file:// load through the object element (fetch cannot read file://
  // in the packaged app — the previous fetch-based recolor emptied the pet).
  newObj.data = getStateAssetPath(state);
}

// The initial SVG is hard-coded in pet.html without any transition setup or
// positioning — mirror the runtime swap target so subsequent cross-fades work
// and eye/body transforms animate from the start.
if (currentObject) {
  currentObject.style.position = 'absolute';
  currentObject.style.inset = '0';
  currentObject.style.transition = `opacity ${FADE_MS}ms ease-out`;
  currentObject.addEventListener('load', () => {
    setupTransitions(currentObject);
    recolorObject(currentObject);
  });
}

window.petAPI.onCharacterChanged((characterId: string) => {
  if (characterId === currentCharacterId) return;
  currentCharacterId = characterId;
  // Re-skin immediately: reload the idle pose; recolorObject applies the new
  // palette when it loads, and all later states pick it up too.
  loadSvg('idle');
});

window.petAPI.onStateChange((state: string) => {
  loadSvg(state);
});

window.petAPI.onEyeMove(({ eyeDx, eyeDy, bodyDx, bodyRotate }) => {
  if (!currentObject) return;
  const doc = currentObject.contentDocument;
  if (!doc) return;

  // Target the dedicated wrapper groups (.idle-pupil and .idle-track) rather
  // than the animated .idle-eye / .idle-body. Those already have CSS keyframes
  // running — writing style.transform to them gets overwritten every frame, so
  // tracking becomes invisible. The wrappers have no animation of their own,
  // so their SVG transform attributes stick. Using setAttribute (not style)
  // because SVG transform attributes and CSS transforms are separate channels
  // in SVG — the attribute stacks on top of the descendant's CSS animation
  // without overwriting it.
  const pupil = doc.querySelector('.idle-pupil') as SVGGElement | null;
  const track = doc.querySelector('.idle-track') as SVGGElement | null;

  if (pupil) pupil.setAttribute('transform', `translate(${eyeDx} ${eyeDy})`);
  // rotate(angle cx cy) — rotation center is pinned to (11,12) in SVG units,
  // which is the head center for the idle pose.
  if (track) track.setAttribute('transform', `translate(${bodyDx} 0) rotate(${bodyRotate} 11 12)`);
});
