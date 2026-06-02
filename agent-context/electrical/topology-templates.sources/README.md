# Topology Template Sources

Edit these source files instead of editing `topology-templates.json` by hand.

The runtime still reads the aggregate file for compatibility and speed. Rebuild the aggregate with the matching npm script in `package.json`, or run the full context aggregate check with:

```bash
npm run context:check
```

These source files group already-promoted WP-01 through WP-04 contracts so later WP-05 through WP-12 work can follow the same ownership pattern.
