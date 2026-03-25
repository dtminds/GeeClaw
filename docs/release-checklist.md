# Release Checklist

Use this checklist before cutting a public GeeClaw release.

## Version And Notes

- [ ] Confirm `package.json` version is final.
- [ ] Confirm the release tag will match the package version exactly, for example `v0.9.2`.
- [ ] Update [resources/release-notes.md](../resources/release-notes.md).
- [ ] Confirm release notes match the actual user-facing changes.

## Quality Gates

- [ ] Run `pnpm run lint:check`.
- [ ] Run `pnpm run typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run any platform-specific packaging checks needed for this release.
- [ ] Confirm no unexpected local changes remain in the worktree.

## Security And Privacy

- [ ] Re-read [SECURITY.md](../SECURITY.md) and confirm no known blocker is being shipped silently.
- [ ] Confirm `.env` or any other local secret files are not staged.
- [ ] Confirm signing credentials and release tokens come from CI secrets, not local hard-coded values.
- [ ] Confirm no screenshots, docs, tests, or assets expose private maintainer paths, emails, invite links, or tokens.
- [ ] Review high-risk areas touched in the release, especially auth, provider keys, updater flows, Host API, and local file access.

## Docs And Community Readiness

- [ ] Update [README.md](../README.md) if user-facing behavior changed.
- [ ] Update [README.zh-CN.md](../README.zh-CN.md) if user-facing behavior changed.
- [ ] Update [CONTRIBUTING.md](../CONTRIBUTING.md), [SUPPORT.md](../SUPPORT.md), or [SECURITY.md](../SECURITY.md) if contributor or reporting workflows changed.
- [ ] Confirm issue and PR templates still reflect the current workflow.

## Build And Distribution

- [ ] Verify required GitHub Actions secrets are present for the release workflow.
- [ ] Confirm release workflow inputs, channels, and artifact names match the intended release.
- [ ] Confirm bundled runtimes and packaged assets are up to date.
- [ ] If publishing a prerelease, confirm the prerelease channel and messaging are correct.

## Post-Release

- [ ] Verify GitHub Release artifacts uploaded successfully.
- [ ] Verify release notes render correctly on the release page.
- [ ] Verify auto-update metadata looks correct for the target channel.
- [ ] Smoke test at least one packaged build from the published artifacts.
- [ ] Open follow-up issues for any intentionally deferred release concerns.
