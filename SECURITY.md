# Security Policy

## Supported versions

Security fixes are applied to the current `main` branch. Until tagged releases
exist, no older revision receives a separate support commitment.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability or exposed secret.

Use GitHub's private vulnerability reporting for this repository:

`https://github.com/leafgon/leafstack/security/advisories/new`

Include a concise impact statement, affected files or routes, reproduction
steps, and any suggested remediation. Redact live credentials, tokens, cookies,
private graph payloads, runtime file references, and provider data.

If private vulnerability reporting is unavailable, contact the Leafgon
organization maintainers privately through GitHub before sharing technical
details publicly.

## Credential exposure

If a Leafgon token may have been exposed:

1. revoke or destruct the corresponding `leafelement(token)` pattern;
2. create a new token node with a new UUID;
3. update the authorized consumer through a secret manager; and
4. inspect repository history, logs, CI artifacts, issue text, and graph data
   for copies of the old value.

Do not rely on deleting the latest file revision: rotate the credential even
when the exposed text appears to have been removed.

## Scope

This policy covers the code and documentation in this repository. Service
availability and account-support questions belong in the channels described in
[SUPPORT.md](SUPPORT.md).
