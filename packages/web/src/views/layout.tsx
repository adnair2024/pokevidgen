import type { FC, PropsWithChildren } from 'hono/jsx';

const NAV = [
  ['/', 'Dashboard'],
  ['/build', 'Build a team'],
  ['/teams', 'Teams'],
  ['/bosses/red', 'Bosses'],
  ['/pronunciations', 'Pronunciations'],
  ['/publish', 'Publish'],
  ['/data', 'Data'],
] as const;

/** Live word counts under script fields: any [data-count] input shows its words in the next .count element. */
const COUNTER = `
document.addEventListener('input', function (e) {
  var el = e.target;
  if (!el || !el.hasAttribute || !el.hasAttribute('data-count')) return;
  var words = el.value.trim() ? el.value.trim().split(/\\s+/).length : 0;
  var out = el.parentElement.querySelector('.count') || el.nextElementSibling;
  if (out) { out.textContent = words + ' words'; }
});`;

export const Layout: FC<PropsWithChildren<{ title: string; active?: string }>> = ({ title, active, children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · pokevidgen</title>
      <link rel="stylesheet" href="/static/style.css" />
      <script src="/static/htmx.js" defer></script>
    </head>
    <body>
      <header class="top">
        <a class="brand" href="/">pokevidgen</a>
        <nav>
          {NAV.map(([href, label]) => (
            <a href={href} class={active === href ? 'active' : ''}>{label}</a>
          ))}
        </nav>
      </header>
      <main>{children}</main>
      <script dangerouslySetInnerHTML={{ __html: COUNTER }} />
      <footer>Fan project. Pokémon is © Nintendo / Game Freak. Not official.</footer>
    </body>
  </html>
);
