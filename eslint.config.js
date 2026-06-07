import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // supabase/functions runs on Deno (its own `deno lint`/type-checking story —
  // `Deno.serve`, `npm:` specifiers, etc. — would just look like errors here).
  globalIgnores(['dist', 'supabase/functions/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // useAuth() is colocated with its <AuthProvider> — the standard
      // context+hook pairing React's own docs recommend. That mixes a
      // non-component export into a component file, which is exactly what
      // this rule polices for Fast Refresh's sake; allowlisting the name
      // keeps the check live for genuinely-accidental exports elsewhere.
      'react-refresh/only-export-components': ['error', { allowConstantExport: true, allowExportNames: ['useAuth'] }],

      // set-state-in-effect is new in eslint-plugin-react-hooks@7's
      // "recommended" set and pushes toward patterns that pre-empt the React
      // Compiler (data-fetching libraries, `use()` + Suspense) by flagging
      // any effect that even transitively calls a state setter. This app
      // intentionally fetches with useEffect + realtime subscriptions
      // (useMatches, useAuth, every page's loadXxx — complete with
      // ignore-guards and unsubscribe-on-cleanup, the standard pre-Compiler
      // approach) and isn't adopting the Compiler, so the heuristic — "this
      // setState call, reached via an awaited network request, could in
      // theory cascade" — only produces noise here.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
