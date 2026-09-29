# Contribution guidelines

Thanks for your interest in our project. Contributions are welcome. Feel free to open an issue with questions or reporting ideas and bugs, or open pull requests to contribute code.

It's important to us that we have a welcoming and respectful environment for everybody here. Please be kind.

By submitting a contribution to this repository you agree that you do this under the license of the repository and certify that you have all the rights to do so.

## Development

- Setup, style build and tests: [docs/development.md](docs/development.md). Run `npm run build` and `npm test` before opening a pull request.
- `styles/world.style.json` is generated. Edit `scripts/build-style.mjs` or `styles/map-model.mjs`, rebuild and commit the result; CI fails if the committed file differs from a fresh build.
- Documentation lives in [docs/](docs/); keep `README.md` short and put detail in the matching topic file.
