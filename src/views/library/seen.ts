// Runs once, when an element comes near the view. A wall asks for its pictures this way, because a collection
// of a thousand acts must not ask a thousand times for what nobody has scrolled to.

const AHEAD = '400px';

export function seen(node: Element, arrive: () => void) {
  const watch = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      watch.disconnect();
      arrive();
    },
    { rootMargin: AHEAD },
  );
  watch.observe(node);
  return { destroy: () => watch.disconnect() };
}
