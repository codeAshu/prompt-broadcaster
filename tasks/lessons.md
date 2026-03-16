# Lessons Learned

## Git & GitHub

### Always Add/Update README on Push
**Pattern**: Whenever pushing anything to GitHub, always add a fresh README or update the existing one with the changes.

**Why**: A good README is essential for:
- Quick understanding of what the project does
- Installation and usage instructions
- Keeping documentation in sync with code changes

**Action**: Before any `git push`, check if README needs to be created or updated to reflect the changes being pushed.

## Chrome Extension Development

### ES Modules vs importScripts
**Pattern**: When using `"type": "module"` in manifest.json for service workers, you MUST use ES module `import` syntax, NOT `importScripts()`.

**Why**: `importScripts()` is only available in classic (non-module) service workers. ES modules use `import/export`.

**Wrong**:
```javascript
// manifest.json: "type": "module"
importScripts('lib/memory.js'); // ERROR!
```

**Correct**:
```javascript
// manifest.json: "type": "module"
import { MemorySystem } from './lib/memory.js';
```

**Action**: When writing service workers, decide upfront: classic (importScripts) or module (import). Don't mix.
