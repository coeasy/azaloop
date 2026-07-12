# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security vulnerabilities seriously. Please report by emailing the maintainers directly.

**Do not** create public GitHub issues for security vulnerabilities.

### What to include

- Type of vulnerability
- Steps to reproduce
- Affected versions
- Potential impact
- Suggested fix (if any)

### Response timeline

- Acknowledgment within 48 hours
- Initial assessment within 5 business days
- Fix timeline communicated after assessment

## Security Practices

AzaLoop includes built-in security features:

- **Secret scanning** (`aza_security_scan`) — detects API keys, tokens, and credentials before commit
- **Injection defense** — prevents prompt injection in MCP tool calls
- **PII detection** — identifies personally identifiable information in code
- **Dependency scanning** — automated via CI/CD pipeline
- **Code signing** — all npm packages published with provenance

## Scope

- @azaloop/mcp-server — MCP protocol implementation
- @azaloop/core — Loop engine and security tools
- @azaloop/cli — CLI interface
- @azaloop/shared — Shared types and schemas
