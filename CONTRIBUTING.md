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
