# Changelog

## [0.14.1](https://github.com/ifigueroap/rustbox/compare/v0.14.0...v0.14.1) (2026-11-13)


### Bug Fixes

* mute playing audio during Do Not Disturb and restore it after ([#60](https://github.com/ifigueroap/rustbox/issues/60)) ([cf45a8f](https://github.com/ifigueroap/rustbox/commit/cf45a8f212b7e8d2553d7cfeaeb764e485a64062))

## [0.14.0](https://github.com/ifigueroap/rustbox/compare/v0.13.0...v0.14.0) (2026-11-12)


### Features

* drag-and-drop reordering for sidebar services ([#57](https://github.com/ifigueroap/rustbox/issues/57)) ([b15e83b](https://github.com/ifigueroap/rustbox/commit/b15e83b3e80bfbe68c9654d9e7fee71d0ff6ba84))


### Bug Fixes

* **linux:** report per-service media permission to navigator.permissions.query ([#56](https://github.com/ifigueroap/rustbox/issues/56)) ([4b6ccc2](https://github.com/ifigueroap/rustbox/commit/4b6ccc20e9936b0e1cc6d88357381ecf518584f5))
* **linux:** stop webview flicker when switching services and resizing ([#58](https://github.com/ifigueroap/rustbox/issues/58)) ([c13fea9](https://github.com/ifigueroap/rustbox/commit/c13fea9484e3f848a9198b42f01dfaa091b70684))

## [0.13.0](https://github.com/ifigueroap/rustbox/compare/v0.12.1...v0.13.0) (2026-11-11)


### Features

* add per-service permission settings for media, screen, location and clipboard ([#54](https://github.com/ifigueroap/rustbox/issues/54)) ([b96fae1](https://github.com/ifigueroap/rustbox/commit/b96fae133c97db0e217b7103abad776002fc1efd))

## [0.12.1](https://github.com/ifigueroap/rustbox/compare/v0.12.0...v0.12.1) (2026-11-11)


### Bug Fixes

* **linux:** keep service webview input aligned with what is drawn ([#51](https://github.com/ifigueroap/rustbox/issues/51)) ([8528428](https://github.com/ifigueroap/rustbox/commit/8528428a7a3435eeec26f499aafe7f0637443294))
* restore sidebar drag reordering and in-app camera/microphone prompts ([#52](https://github.com/ifigueroap/rustbox/issues/52)) ([03ce02c](https://github.com/ifigueroap/rustbox/commit/03ce02cc2c579081f3bf96b010a081372c1cea42))

## [0.12.0](https://github.com/ifigueroap/rustbox/compare/v0.11.1...v0.12.0) (2026-11-10)


### Features

* add find in page and remembered per-service zoom ([#48](https://github.com/ifigueroap/rustbox/issues/48)) ([9263eb0](https://github.com/ifigueroap/rustbox/commit/9263eb06f79829a7e91c6eb91012a458b781b835))
* add global and workspace Do Not Disturb schedules ([#46](https://github.com/ifigueroap/rustbox/issues/46)) ([c9c5e52](https://github.com/ifigueroap/rustbox/commit/c9c5e527541725d68a102a57598bb87525e67641))
* add per-service cache clearing, log out and spellcheck ([#43](https://github.com/ifigueroap/rustbox/issues/43)) ([0691881](https://github.com/ifigueroap/rustbox/commit/0691881615d04b6bfe0b3639264d50428f498e37))
* export and import the configuration ([#45](https://github.com/ifigueroap/rustbox/issues/45)) ([5c8e721](https://github.com/ifigueroap/rustbox/commit/5c8e721fe06d2140640950764eacbac6aecca47a))
* focus the service when its notification is clicked ([#42](https://github.com/ifigueroap/rustbox/issues/42)) ([5896a62](https://github.com/ifigueroap/rustbox/commit/5896a62f395954be6e55c67a52d6a28eece2a965))
* hibernate idle background services ([#44](https://github.com/ifigueroap/rustbox/issues/44)) ([1b97c87](https://github.com/ifigueroap/rustbox/commit/1b97c87cfa7aa72c01ea98a577ca52f660512787))
* start at login, optionally hidden in the tray ([#47](https://github.com/ifigueroap/rustbox/issues/47)) ([56ae7f7](https://github.com/ifigueroap/rustbox/commit/56ae7f73cda5dbaf09736c3abe84b903f8b9f0cc))

## [0.11.1](https://github.com/ifigueroap/rustbox/compare/v0.11.0...v0.11.1) (2026-11-09)


### Bug Fixes

* keep unread counts on Home during Do Not Disturb ([#40](https://github.com/ifigueroap/rustbox/issues/40)) ([14e7d2b](https://github.com/ifigueroap/rustbox/commit/14e7d2b952ce68ae6a5b9bf8e92c1368c7c09bf5))

## [0.11.0](https://github.com/ifigueroap/rustbox/compare/v0.10.1...v0.11.0) (2026-11-04)


### Features

* let a service notify even in Do Not Disturb ([#39](https://github.com/ifigueroap/rustbox/issues/39)) ([11a7dee](https://github.com/ifigueroap/rustbox/commit/11a7deedea903ee18e28269cc65acddf86e1bdc8))


### Bug Fixes

* **linux:** depend on GStreamer plugins and keep the DMA-BUF workaround to the AppImage ([#37](https://github.com/ifigueroap/rustbox/issues/37)) ([f6db3f0](https://github.com/ifigueroap/rustbox/commit/f6db3f0eb501ee22cdf92b03061844e7474cdef2))

## [0.10.1](https://github.com/ifigueroap/rustbox/compare/v0.10.0...v0.10.1) (2026-11-01)


### Bug Fixes

* **release:** stop the LICENSE tarball check failing on SIGPIPE ([#35](https://github.com/ifigueroap/rustbox/issues/35)) ([bae3f55](https://github.com/ifigueroap/rustbox/commit/bae3f554ca8ed97a71196620dea254ffcc7e8e2e))

## [0.10.0](https://github.com/ifigueroap/rustbox/compare/v0.9.1...v0.10.0) (2026-11-01)


### Features

* build an Arch package from source against the system WebKitGTK ([#33](https://github.com/ifigueroap/rustbox/issues/33)) ([ba70300](https://github.com/ifigueroap/rustbox/commit/ba70300cb8922aad18a4482df7842520383b72ac))

## [0.9.1](https://github.com/ifigueroap/rustbox/compare/v0.9.0...v0.9.1) (2026-11-01)


### Bug Fixes

* close the service dialog after a create or edit ([#31](https://github.com/ifigueroap/rustbox/issues/31)) ([09c8e90](https://github.com/ifigueroap/rustbox/commit/09c8e90fffecdff5e438a0060e9c741f8b5b8b02))

## [0.9.0](https://github.com/ifigueroap/rustbox/compare/v0.8.0...v0.9.0) (2026-10-30)


### Features

* move workspace controls into Settings ([#29](https://github.com/ifigueroap/rustbox/issues/29)) ([716b21b](https://github.com/ifigueroap/rustbox/commit/716b21bfda5585895a3d6cd45a250020fd78c571))


### Bug Fixes

* render update notes as sanitized markdown ([#28](https://github.com/ifigueroap/rustbox/issues/28)) ([c56e404](https://github.com/ifigueroap/rustbox/commit/c56e404c7d9bd2b951f23e4de9da915bd81b9f09))

## [0.8.0](https://github.com/ifigueroap/rustbox/compare/v0.7.0...v0.8.0) (2026-10-30)


### Features

* add English and Spanish localization ([#26](https://github.com/ifigueroap/rustbox/issues/26)) ([de472f0](https://github.com/ifigueroap/rustbox/commit/de472f0705673e5f57a52f0cc59c557f6869d5a1))


### Bug Fixes

* replace native confirms with an in-app dialog ([#25](https://github.com/ifigueroap/rustbox/issues/25)) ([9f1c918](https://github.com/ifigueroap/rustbox/commit/9f1c91826f966b1af38f245a56d3f0685b3ec7d1))

## [0.7.0](https://github.com/ifigueroap/rustbox/compare/v0.6.0...v0.7.0) (2026-10-29)


### Features

* check for updates and let the user install ([#23](https://github.com/ifigueroap/rustbox/issues/23)) ([4ba3963](https://github.com/ifigueroap/rustbox/commit/4ba3963795365e1e509b64239098466e89a791ea))


### Bug Fixes

* close the window when hiding to the tray fails ([#22](https://github.com/ifigueroap/rustbox/issues/22)) ([b25b2d4](https://github.com/ifigueroap/rustbox/commit/b25b2d451804e2f5505da80d1bd9eb1ae3d243ec))

## [0.6.0](https://github.com/ifigueroap/rustbox/compare/v0.5.1...v0.6.0) (2026-10-28)


### Features

* add a universal macOS build to the release pipeline ([#19](https://github.com/ifigueroap/rustbox/issues/19)) ([8c05805](https://github.com/ifigueroap/rustbox/commit/8c058051a12c5687e48fd7ad41f2e4802a94d5f3))


### Bug Fixes

* show workspace dialogs and the chip popup above service webviews ([#21](https://github.com/ifigueroap/rustbox/issues/21)) ([5bf3707](https://github.com/ifigueroap/rustbox/commit/5bf3707c92f481d162ac347f023af62cdb80b698))

## [0.5.1](https://github.com/ifigueroap/rustbox/compare/v0.5.0...v0.5.1) (2026-10-28)


### Bug Fixes

* keep the workspace rail mounted and dialogs dismissable ([#17](https://github.com/ifigueroap/rustbox/issues/17)) ([c9f004a](https://github.com/ifigueroap/rustbox/commit/c9f004ac45b9266a9ffaccf2aafec17aa77994c1))

## [0.5.0](https://github.com/ifigueroap/rustbox/compare/v0.4.0...v0.5.0) (2026-10-28)


### Features

* add workspaces to group services ([#15](https://github.com/ifigueroap/rustbox/issues/15)) ([984cee5](https://github.com/ifigueroap/rustbox/commit/984cee573041c424862a684b6c77a67ade01103b))

## [0.4.0](https://github.com/ifigueroap/rustbox/compare/v0.3.2...v0.4.0) (2026-10-23)


### Features

* edit services in a dialog and stay in the tray ([c3669c0](https://github.com/ifigueroap/rustbox/commit/c3669c033305a94e05e87cb8edf966b62112a760))
* edit services in a dialog and stay in the tray ([5ecfac7](https://github.com/ifigueroap/rustbox/commit/5ecfac77f5fc0cd04fd023ee16f31a829a5c9655))


### Bug Fixes

* keep dialog fields inside the card and offer both install modes ([a74ec8c](https://github.com/ifigueroap/rustbox/commit/a74ec8c6b45f22dafee04c3cfd3531f1de026699))

## [0.3.2](https://github.com/ifigueroap/rustbox/compare/v0.3.1...v0.3.2) (2026-10-19)

### Features

* use custom Slack and Zulip workspace icons when available
* accept file drops in hosted services

### Bug Fixes

* show the active Do Not Disturb state in its toolbar icon

## [0.3.1](https://github.com/ifigueroap/rustbox/compare/v0.3.0...v0.3.1) (2026-10-19)

### Bug Fixes

* keep same-service links in the current Rustbox webview

## [0.3.0](https://github.com/ifigueroap/rustbox/compare/v0.2.0...v0.3.0) (2026-10-19)

### Features

* add light, dark, and system appearance settings
* add a Windows NSIS installer alongside the portable executable
* improve sidebar context menus and Do Not Disturb indicators

## [0.2.0](https://github.com/ifigueroap/rustbox/compare/v0.1.2...v0.2.0) (2026-10-16)


### Features

* reload, copy, and open services from the sidebar ([c4a5430](https://github.com/ifigueroap/rustbox/commit/c4a543008103ca892ff9b9ba6a563514bbe160c8))
* restore an empty desk and mute services from the sidebar ([671a4eb](https://github.com/ifigueroap/rustbox/commit/671a4eb199b1db044af8ffcb33786da56fdd9565))
* switch services from the keyboard and the tray ([f50e7c8](https://github.com/ifigueroap/rustbox/commit/f50e7c88c51423b7ff83902c3a98560e5f21d896))

## [0.1.2](https://github.com/ifigueroap/rustbox/compare/v0.1.1...v0.1.2) (2026-10-15)


### Bug Fixes

* restore services saved under the previous bundle id ([a2313d0](https://github.com/ifigueroap/rustbox/commit/a2313d06b3ed379e862d64b760564de4199daeca))
