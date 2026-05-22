# Contributing to Lumberjack

Thank you for your interest in contributing to Lumberjack! This document describes how you can contribute to the project.

---

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/moxbo/lumberjack.git
cd lumberjack

# Install dependencies
npm install

# Start development mode
npm run dev
```

---

## 📋 Contribution Workflow

### 1. Create or Find an Issue

- Check if an issue already exists
- For new features: Create an issue and wait for feedback
- For bugs: Create an issue with reproduction steps

### 2. Fork & Branch

```bash
# Create fork (via GitHub UI)
# Then:
git clone https://github.com/YOUR_USERNAME/lumberjack.git
cd lumberjack
git checkout -b feature/my-feature
# or
git checkout -b fix/my-bugfix
```

### 3. Develop

```bash
# Development mode
npm run dev

# Run tests
npm test

# Linting
npm run lint

# Formatting
npm run format
```

### 4. Commit & Push

```bash
git add .
git commit -m "feat: Description of the feature"
git push origin feature/my-feature
```

### 5. Pull Request

- Create PR against `main` branch
- Fill out the PR template
- Wait for CI checks

---

## 📝 Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Usage |
|--------|-------|
| `feat:` | New features |
| `fix:` | Bug fixes |
| `docs:` | Documentation |
| `style:` | Formatting (no code change) |
| `refactor:` | Code refactoring |
| `test:` | Add/modify tests |
| `chore:` | Maintenance, dependencies |

**Examples:**
```
feat: Add TCP listener for real-time logs
fix: Icon now displays correctly in taskbar
docs: Extend README with build instructions
```

> 💡 Commits following this convention are automatically picked up by
> [`git-cliff`](https://git-cliff.org) and grouped into `CHANGELOG.md`
> categories (Added / Fixed / Performance / Changed / …).
> See [Release Workflow](#-release-workflow) below.

---

## 🚢 Release Workflow

This project uses **[Keep a Changelog](https://keepachangelog.com)** + **[Semantic Versioning](https://semver.org)**.
`CHANGELOG.md` is the single source of truth. Pre-Releases (`-beta.N` / `-rc.N`)
get their own version entry; on the next stable release **all commits since the
last stable tag are aggregated** into the new stable entry — including changes
that were never part of any beta.

### Day-to-day

Just write Conventional Commits. The `## [Unreleased]` section in `CHANGELOG.md`
can be regenerated anytime to preview what the next release will contain:

```bash
npm run changelog:unreleased     # Preview Unreleased block (stdout)
npm run changelog:since-stable   # Preview all commits since last STABLE tag
                                  # (= what the next full release will contain)
```

### Cutting a Beta

```bash
# 1) Bump version (e.g. 1.0.16-beta.1) in package.json
# 2) Regenerate full CHANGELOG.md and commit
npm run changelog
git add CHANGELOG.md package.json
git commit -m "chore: release 1.0.16-beta.1 [skip ci]"
git tag v1.0.16-beta.1
git push --follow-tags
```

### Cutting a Release Candidate (recommended before every Full Release)

Same as beta, but tagged `vX.Y.Z-rc.1`. The RC must contain exactly the code
intended for the stable release. If no blocker shows up, promote it.

### Cutting a Full / Stable Release

> 🟢 **Best Practice:** Don't release a stable version that contains commits
> not previously shipped in at least a beta or RC. If `npm run changelog:since-stable`
> shows entries not contained in any pre-release, cut an **RC first**.

```bash
# 1) Bump version (e.g. 1.0.16) in package.json
# 2) Aggregate all commits since the last stable tag into the new entry
npm run changelog
git add CHANGELOG.md package.json
git commit -m "chore: release 1.0.16 [skip ci]"
git tag v1.0.16
git push --follow-tags
```

`npm run release:notes` emits a Markdown snippet suitable for the GitHub Release
body (no header, just the latest version's entries).

### Quick Reference

| Script                            | Purpose                                                  |
|-----------------------------------|----------------------------------------------------------|
| `npm run changelog`               | Regenerate full `CHANGELOG.md`                           |
| `npm run changelog:unreleased`    | Preview `[Unreleased]` block                             |
| `npm run changelog:next`          | Preview next version block (uses `package.json` version) |
| `npm run changelog:since-stable`  | Aggregate commits since last **stable** tag              |
| `npm run release:notes`           | Markdown snippet for GitHub Release body                 |

---

## 🧪 Tests

### Run Unit Tests

```bash
npm test
```

### Run E2E Tests

```bash
npm run test:e2e
```

### Run Specific Test Suites

```bash
# Specific test
tsx ./scripts/test-msg-filter.ts
```

---

## 🎨 Code Style

- **TypeScript** for main and renderer process
- **Preact** for UI components
- **ESLint + Prettier** for formatting

### Automatic Formatting

```bash
npm run format       # Format all files
npm run lint:fix     # Auto-fix lint errors
```

### Pre-Commit Hooks

Husky automatically runs `lint-staged`:
- `.ts/.tsx` files: ESLint + Prettier
- `.json/.md/.css/.html`: Prettier

---

## 📁 Project Structure

```
lumberjack/
├── src/
│   ├── main/         # Electron Main Process
│   ├── renderer/     # Preact UI
│   ├── services/     # Business Logic
│   ├── types/        # TypeScript Definitions
│   └── utils/        # Utility Functions
├── scripts/          # Build & Test Scripts
├── tests/            # E2E Tests
└── docs/             # Documentation
```

---

## 🔧 Development Setup

### Prerequisites

- Node.js 20+ (LTS recommended)
- npm 9+
- Git

### IDE Recommendations

- **VS Code** or **WebStorm**
- Recommended Extensions:
  - ESLint
  - Prettier
  - TypeScript

---

## 📖 Helpful Documentation

| Document | Description |
|----------|-------------|
| [docs/INDEX.md](docs/INDEX.md) | Documentation overview |
| [docs/developer/ARCHITECTURE_DECISION.md](docs/developer/ARCHITECTURE_DECISION.md) | Architecture decisions |
| [docs/developer/PERFORMANCE.md](docs/developer/PERFORMANCE.md) | Performance optimizations |

---

## ❓ Questions?

- Issues: [GitHub Issues](https://github.com/moxbo/lumberjack/issues)
- Discussions: [GitHub Discussions](https://github.com/moxbo/lumberjack/discussions)

---

## 📄 License

By submitting a contribution, you agree that your contribution will be licensed under the [MIT License](LICENSE).

---

Thank you for your contributions! 🪓
