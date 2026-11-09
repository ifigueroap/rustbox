# Changelog

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
