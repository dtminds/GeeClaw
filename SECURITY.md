# Security Policy

GeeClaw is still evolving quickly, but we want vulnerability reporting and response expectations to be clear before broader open-source distribution.

## Supported Versions

We currently provide security fixes on a best-effort basis for the newest maintained code paths only.

| Version / Branch | Security Support |
| --- | --- |
| `main` | Best effort |
| Latest published stable release | Best effort |
| Latest published prerelease (`-alpha`, `-beta`, `-test`) | Limited, no guarantee |
| Older releases | Not supported |

Notes:

- Security fixes may land on `main` first and be included in the next release rather than backported.
- If a vulnerability affects only unsupported versions, we may ask reporters to verify it against `main` or the latest release first.

## Reporting a Vulnerability

Please do not open a public GitHub issue for a suspected security vulnerability.

Preferred process:

1. Use GitHub's private vulnerability reporting feature for this repository if it is enabled.
2. If private reporting is not available, contact the maintainers through a private channel before public disclosure.
3. Include reproduction steps, affected versions or commit range, impact, and any suggested mitigation if you have one.

Useful details to include:

- operating system and app version
- whether the issue affects packaged builds, development mode, or both
- whether secrets, local files, tokens, or remote code execution are involved
- a minimal proof of concept or screenshots if they help

## What to Expect

We aim to:

- acknowledge new reports within 7 days
- keep reporters updated on triage status when the issue is confirmed
- coordinate reasonable disclosure timing before a public fix lands

Response times are best effort and may vary depending on maintainer availability.

## Scope

The most relevant security areas for GeeClaw today include:

- local Host API exposure and renderer/Main trust boundaries
- credential storage and token handling
- bundled runtime, plugin, and updater flows
- packaging, signing, and release distribution paths

## Out of Scope

The following are usually out of scope unless they directly create a meaningful security impact in GeeClaw itself:

- feature requests framed as security improvements
- unsupported historical versions
- issues that require local machine compromise first, unless GeeClaw meaningfully worsens the impact

## Disclosure

Please give us a reasonable opportunity to investigate and prepare a fix before publishing full details.

If you believe a report has not received a response, please follow up through the same private channel with the original report context.
