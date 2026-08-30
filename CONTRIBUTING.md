# Contributing

Thanks for helping improve the LEAF agentic programming toolkit.

## Before opening a change

1. Search existing issues and pull requests.
2. For a substantial feature, open a proposal before implementation so scope
   and public API expectations can be agreed first.
3. Never include API tokens, cookies, authorization headers, runtime file
   references, payload base64, private graph data, or provider credentials.

## Development workflow

Create a focused branch from `main` and keep the diff small. Preserve unrelated
work and avoid mixing generated captures or local graph snapshots into source
changes. Those belong under ignored `artifacts/` or `.tmp/`.

When changing a skill:

- keep `SKILL.md` self-contained and link only the references needed;
- update the relevant reference when public behavior or safety requirements
  change;
- update or add a focused test for helper behavior; and
- use public leaf-server and GhostOS interfaces rather than private source
  repositories.

When changing graph or Blob API guidance, document the required scopes and
separate read-only operations from production-visible mutations.

## Validation

Run both canonical validation commands:

```bash
.agents/skills/leaf/scripts/validate-skill.sh
bash .agents/skills/leaf-blob-api/scripts/validate-skill.sh
```

Also run:

```bash
git diff --check
```

Tests must not require a real token or mutate a live namespace. If validation
of deployed behavior is essential, use an explicitly authorized test namespace
and describe the non-sensitive evidence in the pull request.

## Pull requests

A pull request should include:

- the problem and intended user outcome;
- a concise description of the change;
- commands and tests run;
- security, compatibility, and rollout risks;
- documentation updates for user-visible behavior; and
- confirmation that no secrets or private data are present.

By contributing, you agree that your contribution is licensed under this
repository's [MIT License](LICENSE).
