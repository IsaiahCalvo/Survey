// The /tools hub: a search box over the grouped tool lists. The rows are plain
// links in the page, so without this everything still shows.
const find = document.querySelector('[data-hub]');
const input = find.querySelector('#tool-search');
const none = find.querySelector('.hub-none');
const groups = [...document.querySelectorAll('[data-group]')];

function apply() {
  const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const box of groups) {
    // "Most used" repeats tools from the groups, so it hides while searching.
    const popular = box.dataset.group === 'popular';
    let visible = 0;
    for (const row of box.querySelectorAll('.trow')) {
      const hit = !(popular && words.length) && words.every((w) => row.dataset.k.includes(w));
      row.parentElement.hidden = !hit;
      if (hit) visible += 1;
    }
    box.hidden = visible === 0;
    if (!popular) shown += visible;
  }
  none.hidden = shown > 0;
}

find.hidden = false;
input.addEventListener('input', apply);
// Enter opens the tool when the search leaves exactly one.
input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const hits = document.querySelectorAll('.tcol li:not([hidden]) .trow');
  if (hits.length === 1) location.href = hits[0].href;
});
const q = new URLSearchParams(location.search).get('q');
if (q) {
  input.value = q;
  apply();
}
