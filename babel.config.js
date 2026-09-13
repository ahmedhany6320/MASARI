/**
 * Babel configuration.
 *
 * Exists for one reason: `import.meta`.
 *
 * Zustand's middleware module ships a devtools helper that reads
 * `import.meta.env.MODE`. This app never uses devtools, but Metro does not
 * tree-shake, so the expression lands in the web bundle anyway — and
 * `expo export --platform web` emits a plain `<script defer>`, not a module.
 * `import.meta` inside a classic script is a SYNTAX error, not a runtime one,
 * so it is thrown while parsing and the whole bundle fails to execute. The web
 * build served a blank page, with nothing in the console pointing at any line
 * of this app's own code.
 *
 * Rewriting it to an empty object makes every guarded read of `import.meta.env`
 * undefined, which takes exactly the fallback branch those guards exist for.
 * Done here rather than by patching the generated HTML, so it survives the
 * next export.
 */
function importMetaShim({ types: t }) {
  return {
    name: 'masari-import-meta-shim',
    visitor: {
      MetaProperty(path) {
        if (path.node.meta.name === 'import' && path.node.property.name === 'meta') {
          path.replaceWith(t.objectExpression([]));
        }
      },
    },
  };
}

/*
 * Resolved through `expo` rather than by bare name. `babel-preset-expo` is not
 * a direct dependency — Expo resolves it internally when no babel config
 * exists — so naming it here would work only by accident of hoisting, and in
 * this tree it is nested under `expo/node_modules` and does not resolve at all.
 */
const expoPreset = require.resolve('babel-preset-expo', {
  paths: [require('path').dirname(require.resolve('expo/package.json'))],
});

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [expoPreset],
    plugins: [importMetaShim],
  };
};
