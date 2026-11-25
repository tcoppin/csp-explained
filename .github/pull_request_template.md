<!-- Thanks! See CONTRIBUTING.md. Delete what doesn't apply. -->

## What and why

## Checks

- [ ] The title follows Conventional Commits (`fix(analyzer): …`): it decides the next version.
- [ ] Each commit is signed off (`git commit -s`).
- [ ] `yarn test`, `yarn check`, `yarn build` and `yarn test:e2e` pass.
- [ ] A change to the interface: screenshots on desktop and a phone, in both themes, and its accessibility tests
      (CONTRIBUTING.md › Accessibility).
- [ ] New or changed text is in `en` and `fr` (or left to translate, see `yarn i18n:status fr`).
- [ ] A catalogue change: `yarn catalogue:validate` passes, and `sources` link the vendor's public documentation.
