# Workspace Rules & Guidelines

## Versioning
- **Auto Version Bump**: Whenever code changes or feature updates are completed, always bump the version in `package.json`, `package-lock.json`, and add a matching top entry in `CHANGELOG.md` (which `utils/version.js` reads dynamically) before committing.

## Git Workflow
- **Auto Commit & Push**: Whenever code changes or feature updates are completed, always stage (`git add`), commit with a descriptive message (`git commit`), and push immediately (`git push origin <branch>`) to remote repository without waiting for user prompting.
