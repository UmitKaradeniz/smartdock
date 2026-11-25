# Code signing policy

Free code signing for Windows releases is provided by [SignPath.io](https://about.signpath.io), with a certificate from the [SignPath Foundation](https://signpath.org).

## What is signed

Only installers built by the [release workflow](.github/workflows/release.yml) on GitHub-hosted runners, from a version tag in this public repository. Nothing built on a personal computer is signed.

## Team roles

- **Committers and reviewers:** [repository owner](https://github.com/UmitKaradeniz)
- **Approvers:** [repository owner](https://github.com/UmitKaradeniz)

Every signing request is approved by hand in SignPath. All accounts with access to this repository and to SignPath use multi-factor authentication.

## Privacy

smartdock sends no information to other networked systems unless the user turns on a feature that needs it. The features that make network requests, and where they go, are listed under "Gizlilik ve ağ erişimi" in the [README](README.md). There is no account, no server and no telemetry.
