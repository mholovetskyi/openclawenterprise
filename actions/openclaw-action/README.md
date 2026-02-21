# OpenClaw GitHub Action

Run [OpenClaw](https://github.com/openclaw/openclaw) AI agent tasks directly in your GitHub Actions workflows.

## Usage

### Code Review on every PR

```yaml
name: AI Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: openclaw/openclaw-action@v1
        with:
          task: "Review this pull request for bugs, security issues, and style violations. Post a summary as a PR comment."
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Security scan on push

```yaml
- uses: openclaw/openclaw-action@v1
  with:
    skill: security-scan
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Auto-generate tests

```yaml
- uses: openclaw/openclaw-action@v1
  with:
    task: "Write unit tests for any files changed in this PR"
    output-file: generated-tests.md
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `task` | No | | Natural language task description |
| `skill` | No | | Specific skill to invoke |
| `config` | No | `.openclaw/config.yaml` | Path to config file |
| `version` | No | `latest` | OpenClaw version |
| `anthropic-api-key` | No | | Anthropic API key |
| `openai-api-key` | No | | OpenAI API key |
| `working-directory` | No | `.` | Working directory |
| `output-file` | No | | Write output to file |
| `fail-on-error` | No | `true` | Fail workflow on agent error |
| `timeout-minutes` | No | `10` | Max run time in minutes |

## Outputs

| Output | Description |
|--------|-------------|
| `result` | Agent stdout output |
| `exit-code` | Process exit code |
| `output-file` | Path to output file (if set) |
