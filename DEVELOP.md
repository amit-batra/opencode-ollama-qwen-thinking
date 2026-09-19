# Development and Publishing

This file contains maintainer/developer instructions that are intentionally kept out of the user-facing README.

## Prerequisites

- A GitHub account with write access to this repository.
- An npm account with permission to publish the package.
- Bun 1.1.0 or later.
- Node.js/npm available if you prefer to use npm for authentication and publishing.
- Git.

## Local development

Install dependencies:

```bash
bun install
```

Run the test suite:

```bash
bun test
```

Run the proxy directly during development:

```bash
bun run proxy
```

The proxy listens on `127.0.0.1:11437` by default.

## Verify the npm package before publishing

Build a local npm tarball without publishing it:

```bash
npm pack --dry-run
```

Review the file list carefully. The package should contain the plugin source, proxy, reasoning logic, generator, README, LICENSE, and this development guide.

You can also create the actual tarball:

```bash
npm pack
```

This produces a file such as:

```text
opencode-ollama-qwen-thinking-0.1.0.tgz
```

Do not commit the generated `.tgz` file.

## Publish the package

### 1. Make sure the version is correct

Update the `version` field in `package.json`. npm does not allow re-publishing the same package version.

For example:

```bash
npm version 0.1.0
```

This creates a Git commit and tag when run in a clean Git repository.

### 2. Authenticate with npm

If you are not already authenticated:

```bash
npm login
```

Verify the active account:

```bash
npm whoami
```

### 3. Check package metadata

Before publishing:

```bash
npm view opencode-ollama-qwen-thinking
```

If the package name has not been published yet, this may report a 404. That is expected for the first publication.

### 4. Publish

For the first public release:

```bash
npm publish
```

Because this is an unscoped package, it is public by default.

### 5. Verify the published package

After npm accepts the publication:

```bash
npm view opencode-ollama-qwen-thinking version
npm view opencode-ollama-qwen-thinking dist.tarball
```

Then verify that OpenCode can load the published package.

## Install the published plugin in OpenCode

The preferred user-facing installation is through OpenCode's npm plugin support:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-ollama-qwen-thinking@0.1.0"
  ]
}
```

OpenCode installs npm plugins automatically using Bun. Users do not need to clone this repository or run `npm install` manually.

For development against the local checkout, continue using the repository path described in the README.

## Releasing a new version

1. Make and test the changes.
2. Update the version:

```bash
npm version patch
```

Use `minor` or `major` when appropriate:

```bash
npm version minor
npm version major
```

3. Push the commit and tag:

```bash
git push origin main --follow-tags
```

4. Publish:

```bash
npm publish
```

5. Verify:

```bash
npm view opencode-ollama-qwen-thinking version
```

## Important publishing notes

- **Never reuse an already-published version number.** npm package versions are immutable.
- Run `bun test` before every release.
- Run `npm pack --dry-run` before publishing so that unwanted files do not enter the package.
- Do not put npm credentials, tokens, or local `.env` files into the repository.
- The package is intended to be loaded by OpenCode's Bun runtime; Bun is therefore a runtime prerequisite even for users who never clone the repository.
