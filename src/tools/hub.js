// The /tools hub: a search box and category buttons over the tool cards. The
// cards are plain links in the page, so without this everything still shows.
const find = document.querySelector('[data-hub]');
const input = find.querySelector('#tool-search');
const chips = [...find.querySelectorAll('.chip')];
const none = find.querySelector('.hub-none');
const sections = [...document.querySelectorAll('.tgroup')];
let group = '';

function apply() {
  const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
  const filtering = words.length > 0 || group !== '';
  let shown = 0;
  for (const sec of sections) {
    const g = sec.dataset.group;
    // "Most used" repeats tools from the groups, so it hides while filtering.
    const inPlay = g === 'popular' ? !filtering : !group || g === group;
    let visible = 0;
    for (const card of sec.querySelectorAll('.tcard')) {
      const hit = inPlay && words.every((w) => card.dataset.k.includes(w));
      card.hidden = !hit;
      if (hit) visible += 1;
    }
    sec.hidden = visible === 0;
    if (g !== 'popular') shown += visible;
  }
  none.hidden = shown > 0;
}

find.hidden = false;
input.addEventListener('input', apply);
for (const chip of chips) {
  chip.addEventListener('click', () => {
    group = chip.dataset.g;
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    apply();
  });
}
const q = new URLSearchParams(location.search).get('q');
if (q) {
  input.value = q;
  apply();
}
