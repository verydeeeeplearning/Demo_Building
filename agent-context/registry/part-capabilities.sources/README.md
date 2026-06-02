# Part Capability Sources

Edit these category files instead of editing `../part-capabilities.json` by hand.

The runtime still reads the aggregate file for speed and compatibility. Rebuild it with:

```bash
npm run context:parts:build
```

Before committing context changes, verify source and aggregate drift with:

```bash
npm run context:parts:check
```

Categories are intentionally broad so future WP-05 through WP-12 work can add parts without touching a multi-thousand-line registry file.
