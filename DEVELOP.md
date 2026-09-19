# Development and Publishing

This file contains maintainer/developer instructions that are intentionally kept out of the user-facing README.

## Prerequisites

- A GitHub account with write access to this repository.
- An npm account with permission to publish the package.
- Bun 1.1.0 or later.
- Node.js 22.14.0 or later.
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

Review the file list carefully. The package should contain the plugin source, proxy, reasoning logic, generator, README, and LICENSE. It intentionally does **not** include this development guide.

You can also create the actual tarball:

```bash
npm pack
```

This produces a file such as:

```text
opencode-ollama-qwen-thinking-0.1.0.tgz
```

Do not commit the generated `.tgz` file.

## npm publishing

This repository uses **GitHub Actions Trusted Publishing** for normal releases. The workflow at `.github/workflows/publish.yml` publishes when a `v*` tag is pushed.

Trusted Publishing uses GitHub's OIDC identity instead of storing a long-lived npm publish token in GitHub. npm requires Node.js 22.14.0+ and npm CLI 11.5.1+ for this flow.

### One-time bootstrap

There is an important npm constraint: a trusted publisher is configured on an npm package that already exists. Therefore, the very first `0.1.0` publication has to be bootstrapped separately.

If you do not want to configure npm account 2FA, use a short-lived **granular access token with bypass 2FA** only for this first publication:

1. On npmjs.com, create a granular access token with:
   - **Packages and scopes:** Read and write (publish and stage).
   - **Bypass two-factor authentication:** enabled.
   - A short expiration.
   - Access limited to this package if npm offers the package selector at token creation time.
2. Use the token only for the initial publication. Do not commit it or add it to GitHub.
3. From the repository root, use the token through a temporary npm config file and publish `0.1.0`:

```bash
export NPM_TOKEN="<token>"
printf '//registry.npmjs.org/:_authToken=%s\\n' "$NPM_TOKEN" > .npmrc.bootstrap
NPM_CONFIG_USERCONFIG="$PWD/.npmrc.bootstrap" npm publish
rm -f .npmrc.bootstrap
unset NPM_TOKEN
```

This keeps the token out of your normal npm configuration. Do not commit `.npmrc.bootstrap`.

npm is currently deprecating direct publishing with bypass-2FA tokens; that path is expected to be removed in January 2027. It is therefore intended here only as a bootstrap mechanism.

### Configure GitHub Actions as the trusted publisher

After `0.1.0` exists on npm:

1. Open the package's **Settings → Trusted publishing** on npmjs.com.
2. Select **GitHub Actions**.
3. Enter:
   - **Organization or user:** `amit-batra`
   - **Repository:** `opencode-ollama-qwen-thinking`
   - **Workflow filename:** `publish.yml`
   - **Environment:** leave empty.
4. Allow **`npm publish`** for this trusted publisher.
5. Save the configuration.

The repository's `package.json` already has the required repository URL:

```text
https://github.com/amit-batra/opencode-ollama-qwen-thinking.git
```

npm requires that repository URL to match the GitHub repository used for trusted publishing.

### Recommended npm package setting

Once Trusted Publishing is configured and verified, go to the package's **Settings → Publishing access** and select:

**Require two-factor authentication and disallow tokens**

This prevents traditional npm tokens from being used to publish the package. GitHub Actions Trusted Publishing continues to work because it authenticates through OIDC.

### Release a new version

1. Make and test the changes:

```bash
bun test
npm pack --dry-run
```

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

4. GitHub Actions will run `.github/workflows/publish.yml` and publish the tagged version to npm using Trusted Publishing.

5. Verify the release:

```bash
npm view opencode-ollama-qwen-thinking version
npm view opencode-ollama-qwen-thinking dist.tarball
```

### Optional: manual/local publishing

Manual `npm publish` is intentionally not part of the normal release process. After Trusted Publishing is configured with token publishing disabled, local direct publishing will require interactive npm 2FA.

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

## Important publishing notes

- **Never reuse an already-published version number.** npm package versions are immutable.
- Run `bun test` before every release.
- Run `npm pack --dry-run` before publishing so that unwanted files do not enter the package.
- Do not put npm credentials, tokens, or local `.env` files into the repository.
- The package is intended to be loaded by OpenCode's Bun runtime; Bun is therefore a runtime prerequisite even for users who never clone the repository.
