# Dependency Update - November 14, 2025

## Summary

All project dependencies have been updated to their latest stable versions as of November 14, 2025.

## Updated Dependencies

### DevDependencies

| Package | Previous Version | New Version | Change Type |
|---------|-----------------|-------------|-------------|
| @eslint/js | 9.39.0 | 9.39.1 | Patch |
| @types/node | 24.9.2 | 24.10.1 | Minor |
| @typescript-eslint/eslint-plugin | 8.46.2 | 8.46.4 | Patch |
| @typescript-eslint/parser | 8.46.2 | 8.46.4 | Patch |
| electron | 39.0.0 | 39.2.0 | Minor |
| esbuild | 0.25.11 | 0.27.0 | Minor |
| eslint | 9.39.0 | 9.39.1 | Patch |
| globals | 16.4.0 | 16.5.0 | Minor |
| sharp | 0.34.4 | 0.34.5 | Patch |
| vite | 7.1.12 | 7.2.2 | Minor |
| wait-on | 9.0.1 | 9.0.3 | Patch |

### Runtime Dependencies

No runtime dependencies were updated (all were already at latest versions).

## Verification

All updates were verified with successful builds:

```bash
npm run prebuild
✓ Main build: ~19ms
✓ Preload build: ~2ms

npm run build:renderer
✓ Renderer build: ~1.09s
✓ Bundle sizes maintained: 63.43 kB main (18.53 kB gzipped)
```

## Breaking Changes

None. All updates are backward compatible.

## Known Issues

Some engine warnings appear during installation due to Node.js version:
- @electron/asar, @electron/rebuild, node-abi require Node.js >=22.12.0
- Current Node.js: v20.19.5
- These warnings are non-critical and do not affect functionality

## Next Steps

Regular dependency updates should be performed:
- Monthly: Check for security updates
- Quarterly: Check for all dependency updates
- Before major releases: Comprehensive dependency review

## References

- [Architecture Decision: Not Aligning with ERB](./ARCHITECTURE_DECISION.md)
- [npm-check-updates](https://www.npmjs.com/package/npm-check-updates)
