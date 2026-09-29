# Deployment (GitHub Pages)

The workflow in `.github/workflows/site.yml` builds and validates the style before publishing the `styles/` directory. In a new fork, enable Actions if GitHub has disabled inherited workflows, then choose **Settings → Pages → Build and deployment → Source → GitHub Actions**. Run **Validate and deploy world railway map** if the initial push occurred before Pages was enabled.

All deployment URLs are relative, so the repository subpath works correctly. The workflow also uploads the website as a reviewable artifact. Existing Hack4Rail example styles remain in the repository.

The site is deployed only from `main`; pull requests build and validate without deploying. All workflows, their triggers and the data branches they publish to are listed in [GitHub Actions workflows](workflows.md).
