# Workflows waiting to be installed

The two files next to this one are the repository's CI and GitHub Pages deployment workflows. They
belong in `.github/workflows/`, but they could not be committed there by the automation that opened
the initial pull request: both available credentials lacked the `workflow` permission, so pushing to
that path was rejected.

To install them:

```bash
mkdir -p .github/workflows
git mv docs/workflows/ci.yml .github/workflows/ci.yml
git mv docs/workflows/deploy.yml .github/workflows/deploy.yml
git rm docs/workflows/README.md
git commit -m "Install CI and deployment workflows"
```

Deploying additionally needs **Settings → Pages → Source: GitHub Actions** to be switched on once.

Once they are moved, this directory can go away — the links in the main `README.md` already point at
`.github/workflows/`.
