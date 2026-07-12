# Contributing to AzaLoop

Thank you for your interest in contributing to AzaLoop! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0

### Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/azaloop.git
   cd azaloop
   ```

3. Install dependencies:
   ```bash
   pnpm install
   ```

4. Build the project:
   ```bash
   pnpm build
   ```

5. Run tests:
   ```bash
   pnpm test
   ```

## Development Workflow

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation changes
- `refactor/description` - Code refactoring

### Commit Messages

Use conventional commits:

- `feat: add new feature`
- `fix: resolve bug`
- `docs: update documentation`
- `refactor: improve code structure`
- `test: add tests`
- `chore: maintenance tasks`

### Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Ensure all tests pass: `pnpm test`
4. Ensure type checking passes: `pnpm typecheck`
5. Update documentation if needed
6. Submit a pull request with a clear description

### Code Style

- Follow TypeScript best practices
- Use strict mode (`noImplicitAny: true`)
- Write meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions small and focused

### Testing

- Write unit tests for new functionality
- Ensure all existing tests pass
- Aim for good test coverage
- Use descriptive test names

## Reporting Issues

### Bug Reports

When reporting bugs, please include:

1. A clear and descriptive title
2. Steps to reproduce the issue
3. Expected behavior
4. Actual behavior
5. Environment details (OS, Node.js version, etc.)

### Feature Requests

For feature requests, please include:

1. A clear description of the feature
2. Use cases and benefits
3. Implementation ideas (if any)

## License

By contributing to AzaLoop, you agree that your contributions will be licensed under the MIT License.
