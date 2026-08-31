export async function readPdfjsTextContent(page) {
  const reader = page.streamTextContent().getReader();
  const textContent = { items: [], styles: Object.create(null), lang: null };
  while (true) {
    const { value, done } = await reader.read();
    if (done) return textContent;
    textContent.lang ??= value.lang;
    Object.assign(textContent.styles, value.styles);
    textContent.items.push(...value.items);
  }
}
