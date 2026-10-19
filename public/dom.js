/** Creates an element; `on...` attributes become event listeners and `false` or null ones are skipped. */
export function h(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) {
      continue;
    }
    if (name === "class") {
      node.className = value;
    } else if (name.startsWith("on")) {
      node.addEventListener(name.slice(2), value);
    } else {
      node.setAttribute(name, value === true ? "" : value);
    }
  }
  node.append(...children.filter((child) => child !== null && child !== false));
  return node;
}

/** Replaces the children of `node`, skipping null and false so they are not printed as text. */
export function replaceContent(node, ...children) {
  node.replaceChildren(...children.filter((child) => child !== null && child !== false));
}
