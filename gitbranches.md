# Git Branches

This project uses three branch types:

- `asquii` — primary, stable branch (the project's main branch).
- `dev` — integration branch for completed features.
- `feature/<name>` — temporary branches for individual features or tasks.

## Workflow

1. Create each feature branch from `dev`.
2. Make and commit the feature work on that branch.
3. Merge the finished feature branch into `dev`.
4. Merge `dev` into `asquii` when a release is ready.

Use short, lowercase, hyphen-separated feature names, for example `feature/project-dashboard`.
