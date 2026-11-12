# Linux reload-like flashes and frame pacing

This investigation used v0.13.0 with the patch in this branch, GTK 3,
WebKitGTK 4.1 API / engine 2.54.0, Xvfb/X11, xfwm4 without compositing and
local test pages. It does **not** establish the cause of steady WhatsApp
stuttering or reproduce Arch/Hyprland's GPU/Wayland path.

## Confirmed defect and fix

The old `GtkFixed` size-allocation implementation first allocated children
using their preferred sizes. Rustbox then corrected those allocations in a
`size-allocate` signal handler, after GTK's default handler had already run.
The instrumented app showed service views receiving `(0,0,1,1)` followed by
`(0,0,972,800)`, repeatedly on service switches and on window resizing. This
is a viewport collapse and restoration, not a page navigation. In a baseline
run with repeated switches and refocus cycles, pixel sampling caught the
shell background once out of 446 samples at a location inside the service's
red test element. Pointer hit-testing still worked in the baseline.

An allocation-only build still exposed the shell for one sampled frame at
`GDK_SCALE=2`. The activation path hid the previous service before showing
its replacement, with separate UI dispatches between those operations. The
second fix shows the replacement before hiding other services, retaining a
mapped service across the transition. With both fixes, the scale-1 and
scale-2 runs recorded zero blank samples (410 and 221 samples respectively),
and exact pointer coordinates survived switches, refocus and resize. These
sampled checks cannot exclude sub-sample artifacts.

The host now overrides the allocation implementation and allocates each
child directly at its final viewport. The windowed `GtkEventBox` per service,
its local WebKit origin `(0,0)`, and its visibility mirroring are retained.
This preserves PR #51's input-coordinate fix. No renderer switch, hibernation
policy, session identity, navigation policy or IPC contract changes.

`RUSTBOX_GEOMETRY_TRACE=1` enables an opt-in allocation trace. It records
only widget coordinates and dimensions, never page URLs or session data.
The GTK regression test checks that four successive host allocations send
exactly four final child allocations, with no preferred-size pass.

## Other hypotheses

- Window blur/focus has no application handler that hides, recreates,
  navigates or reloads the service. Refocusing alone did not reproduce a
  viewport collapse or document reload in the local harness.
- Hibernation is off by default. With it enabled, a monotonic timer begins
  when a service becomes background, not when the window loses focus.
  The 30-second sweep excludes the selected service even if Rustbox is
  unfocused. The shortest supported threshold is five minutes. Home and
  shell dialogs make a service background; an eligible service left there
  for the threshold can legitimately unload and reload when reopened.
- Titles use WebKit's title-change event, not polling. Find/zoom restoration
  runs on load or explicit actions. The Slack/Zulip icon observer and
  two-second scan do not run for WhatsApp. The media observer receives DOM
  additions and returns immediately when sound is enabled. No confirmed
  steady frame-pacing defect was found in those paths.
- Native installs leave DMA-BUF enabled and preserve user overrides. Xvfb
  cannot test Hyprland, fractional Wayland scaling, a hardware DMA-BUF
  pipeline, GPU driver behavior or a signed-in WhatsApp workload. WebKit
  throttling, process termination under memory pressure, and site behavior
  remain possibilities rather than findings.

## Reproduce

Build an embedded-frontend executable, then run in a private X display and
D-Bus session to avoid Rustbox's single-instance handoff to another desktop:

```sh
npm run tauri build -- --no-bundle
xvfb-run -a dbus-run-session -- python3 scripts/verify-linux-webviews.py \
  src-tauri/target/release/rustbox --idle-seconds 335
```

Set the binary path to the actual build output when using `CARGO_TARGET_DIR`.
The harness needs `xdotool`, `xfwm4`, `xmessage`, and Python Pillow. Its config,
sessions, local HTTP events and GTK trace are in the printed `/tmp` directory.
It loads only two local pages, measures `load`, `pageshow`, navigation type,
visibility, viewport resize and rAF intervals, asserts pointer targets and
exact client coordinates, and samples a red service element while switching
and focusing another window. Pixel sampling detects blanks lasting across a
sample; it cannot prove absence of shorter compositor artifacts. rAF measures
callback pacing on this synthetic page, not WhatsApp scrolling throughput.

A long allocation-fix run crossed the five-minute threshold: the selected
page retained its boot id and load count 1; the background page woke with a
new boot id and persistent localStorage count 2. The final two-fix run also passed
this check, including persistent localStorage and pointer targeting after wake. Ordinary switches and five refocus cycles caused no loads.
Visible rAF medians were around 17 ms and 95th percentiles 18–20 ms on the
synthetic page. These are not evidence of improved WhatsApp throughput;
large boundary gaps can occur when a hidden page resumes.

The long run checks that the visible page does not reload across the idle
threshold and that reopening the hibernated background service loads it
again with its persistent localStorage counter intact. A short run uses
15 seconds. To verify integer scaling as well:

```sh
xvfb-run -a -s '-screen 0 2800x1800x24' dbus-run-session -- \
  python3 scripts/verify-linux-webviews.py src-tauri/target/release/rustbox --scale 2
xvfb-run -a cargo test --manifest-path src-tauri/Cargo.toml \
  gtk_host_allocates_only_the_final_viewport -- --ignored --test-threads=1
```

## Owner check on Arch/Hyprland

Use the native package with the renderer environment unset first. Compare
returning from another application, switching service rows, and resizing.
Check hover/link targeting after each, including fractional monitor scaling.
If steady WhatsApp stutter remains without GTK allocations, it is a separate
unresolved problem; report the WebKitGTK/Mesa versions, GPU and monitor scale,
and whether a page actually starts loading again or only repaints. Check for
`WebKitWebProcess` exits in the journal/coredump logs locally; do not post
URLs containing credentials or session contents.

As separate diagnostic runs, completely quit Rustbox before each launch:

```sh
RUSTBOX_GEOMETRY_TRACE=1 rustbox
WEBKIT_DISABLE_DMABUF_RENDERER=1 rustbox
WEBKIT_DISABLE_COMPOSITING_MODE=1 rustbox
```

Try the renderer switches one at a time and then remove them. They can reduce
performance and are not recommended defaults for the native package. A
change in behavior would implicate the graphics path but would not, by
itself, identify a particular driver/compositor defect.
