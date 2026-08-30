# Release checklist

Use this checklist for a public repository release or version tag.

## Repository readiness

- [ ] `LICENSE` contains the approved project license and copyright holder.
- [ ] `README.md` accurately describes requirements, public endpoints, token
      scopes, and current commands.
- [ ] `SECURITY.md`, `CONTRIBUTING.md`, `SUPPORT.md`, and the code of conduct
      reflect current maintainership channels.
- [ ] Generated files, local runtime installs, captures, and graph snapshots
      are ignored.
- [ ] No token, cookie, authorization header, private key, runtime file
      reference, payload base64, private graph data, or provider credential is
      present in tracked files or Git history.

## Validation

```bash
.agents/skills/leaf/scripts/inspect-leaf-workspace.sh
.agents/skills/leaf/scripts/validate-skill.sh
bash .agents/skills/leaf-blob-api/scripts/validate-skill.sh
git diff --check
```

- [ ] Tests pass on the minimum supported Node.js version and the current
      supported release.
- [ ] Documentation links resolve locally.
- [ ] Example commands use placeholders and least-privileged scopes.
- [ ] No validation step mutates an unapproved remote namespace.

## GitHub release settings

- [ ] Private vulnerability reporting is enabled.
- [ ] Branch protection requires the validation workflow and review.
- [ ] Issues and discussions are configured to match `SUPPORT.md`.
- [ ] Repository description, topics, homepage, and social preview are current.
- [ ] The default branch is `main` and stale deployment secrets are removed.

## Publish

1. Review the complete diff and commit history.
2. Merge through the protected branch workflow.
3. Create a signed, annotated semantic-version tag when the project adopts
   versioned releases.
4. Publish release notes describing user-visible changes, compatibility,
   security considerations, and migration steps.
5. Re-run a clean-clone quick start after publication.
