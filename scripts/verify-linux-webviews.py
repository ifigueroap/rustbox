#!/usr/bin/env python3
"""X11 lifecycle, geometry and hit-testing regression harness.

Requires Xvfb, xdotool, xfwm4, xmessage and Python Pillow. Run an embedded-
frontend binary (release, or cargo build --features tauri/custom-protocol):
  xvfb-run -a dbus-run-session -- python3 scripts/verify-linux-webviews.py BINARY
Add --idle-seconds 335 to cross the five-minute hibernation threshold. Output
and isolated config/sessions go to a new /tmp directory. No real services load.
"""
import argparse
import collections
import http.server
import json
import os
from pathlib import Path
import re
import statistics
import subprocess
import tempfile
import threading
import time
from PIL import ImageGrab

PAGE = b'''<body style="margin:0;background:white">
<a id="target" href="#" style="position:absolute;left:100px;top:100px;width:120px;height:60px;background:red">HOVER</a>
<div id="anim" style="position:absolute;top:200px;width:40px;height:40px;background:blue"></div>
<script>
const id=location.pathname,boot=crypto.randomUUID();let frames=[],last=0;
function send(type,data={}){fetch('/event',{method:'POST',body:JSON.stringify({id,boot,type,...data})})}
send('load',{nav:performance.getEntriesByType('navigation')[0].type,
 count:localStorage.n=+(localStorage.n||0)+1});
onpageshow=e=>send('pageshow',{persisted:e.persisted});
onresize=()=>send('resize',{w:innerWidth,h:innerHeight});
for(const type of ['focus','blur','visibilitychange'])
 addEventListener(type,()=>send(type,{visibility:document.visibilityState}));
onmousemove=e=>send('hover',{x:e.clientX,y:e.clientY,
 target:document.elementFromPoint(e.clientX,e.clientY)?.id});
function tick(t){if(document.visibilityState==='visible'){if(last)frames.push(t-last);last=t;}else{last=0;}
 anim.style.transform=`translateX(${t%600}px)`;requestAnimationFrame(tick)}
requestAnimationFrame(tick);
setInterval(()=>{send('frames',{frames,visibility:document.visibilityState});frames=[]},2000);
</script>'''


def command(*args):
    return subprocess.check_output(args, text=True, timeout=15).strip()


def run(*args):
    subprocess.run(args, check=True, timeout=15, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=lambda p: str(Path(p).resolve()))
    parser.add_argument('--idle-seconds', type=int, default=15)
    parser.add_argument('--scale', type=int, choices=[1, 2], default=1)
    args = parser.parse_args()
    scale = args.scale
    output = Path(tempfile.mkdtemp(prefix='rustbox-webviews-'))
    print(f'Artifacts: {output}', flush=True)
    events = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(PAGE)

        def do_POST(self):
            event = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            events.append(event)
            with (output / 'events.jsonl').open('a') as log:
                log.write(json.dumps(event) + '\n')
            self.send_response(204)
            self.end_headers()

        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_port
    config_dir = output / 'config/app.rustbox.desktop'
    config_dir.mkdir(parents=True)
    config = {
        'version': 1, 'schemaVersion': 2,
        'workspaces': [{'id': 'main', 'name': 'Main', 'color': '#888888', 'order': 0}],
        'activeWorkspaceId': 'main', 'activeServiceId': 'one',
        'sidebarCollapsed': False, 'updates': {'autoCheck': False},
        'hibernateAfterMinutes': 5,
        'services': [{'id': i, 'name': i, 'url': f'http://127.0.0.1:{port}/{i}',
                      'color': '#888888', 'workspaces': ['main']} for i in ['one', 'two']],
    }
    (config_dir / 'config.json').write_text(json.dumps(config))
    env = dict(os.environ, XDG_CONFIG_HOME=str(output / 'config'),
               XDG_DATA_HOME=str(output / 'data'), RUSTBOX_GEOMETRY_TRACE='1',
               GDK_SCALE=str(scale), GDK_BACKEND='x11')
    processes = []
    stop_samples = threading.Event()
    try:
        processes.append(subprocess.Popen(['xfwm4', '--compositor=off'],
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        time.sleep(1)
        log = (output / 'app.log').open('w')
        app = subprocess.Popen([args.binary], env=env, stdout=log, stderr=subprocess.STDOUT)
        processes.append(app)
        time.sleep(12)
        assert app.poll() is None, 'Rustbox exited; use a private dbus-run-session'
        wid = command('xdotool', 'search', '--onlyvisible', '--pid', str(app.pid)).splitlines()[0]
        run('xdotool', 'windowactivate', '--sync', wid)
        time.sleep(1)

        def geometry():
            raw = command('xwininfo', '-id', wid)
            return {key: int(re.search(pattern + r':\s+(-?\d+)', raw)[1])
                    for key, pattern in [('x', 'Absolute upper-left X'), ('y', 'Absolute upper-left Y')]}

        def hover(label, service):
            g = geometry()
            begin = len(events)
            run('xdotool', 'mousemove', str(g['x'] + 348 * scale), str(g['y'] + 120 * scale))
            time.sleep(.4)
            hits = [e for e in events[begin:] if e['type'] == 'hover']
            assert hits, (label, 'no pointer event')
            hit = hits[-1]
            assert (hit['id'], hit['x'], hit['y'], hit['target']) == (service, 120, 120, 'target'), (label, hit)
            print(label, hit, flush=True)
            run('xdotool', 'mousemove', str(g['x'] + 500 * scale), str(g['y'] + 400 * scale))

        def switch(y):
            g = geometry()
            run('xdotool', 'mousemove', str(g['x'] + 100 * scale), str(g['y'] + y * scale), 'click', '1')
            time.sleep(.5)

        hover('initial', '/one')
        switch(135)
        time.sleep(2)
        hover('second service', '/two')
        switch(90)
        hover('switched back', '/one')
        samples = []
        g = geometry()

        def sample():
            while not stop_samples.is_set():
                pixel = ImageGrab.grab(bbox=(g['x'] + 408 * scale, g['y'] + 140 * scale,
                                             g['x'] + 409 * scale, g['y'] + 141 * scale)).getpixel((0, 0))
                samples.append(pixel[:3])
                time.sleep(.02)

        sampler = threading.Thread(target=sample, daemon=True)
        sampler.start()
        for _ in range(4):
            switch(135)
            switch(90)
        hover('repeated switches', '/one')
        processes.append(subprocess.Popen(['xmessage', '-title', 'Dummy focus', 'other app'],
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        time.sleep(1)
        dummy = command('xdotool', 'search', '--name', 'Dummy focus').splitlines()[-1]
        # Keep the dummy away from the sampled target.
        run('xdotool', 'windowmove', dummy, '0', '0')
        for _ in range(5):
            run('xdotool', 'windowactivate', '--sync', dummy)
            time.sleep(.5)
            run('xdotool', 'windowactivate', '--sync', wid)
            time.sleep(.5)
        hover('refocused', '/one')
        stop_samples.set()
        sampler.join(timeout=5)
        assert samples and not sampler.is_alive(), 'pixel sampler failed'
        bad = [p for p in samples if not (p[0] > 200 and p[1] < 80 and p[2] < 80)]
        print(f'Visual samples: {len(samples)}, non-red: {len(bad)}', flush=True)
        assert not bad, collections.Counter(bad)
        run('xdotool', 'windowsize', wid, str(900 * scale), str(600 * scale))
        time.sleep(2)
        hover('resized', '/one')
        print(f'Idle for {args.idle_seconds}s with five-minute hibernation enabled', flush=True)
        time.sleep(args.idle_seconds)
        hover('after idle', '/one')
        loads = [e for e in events if e['type'] == 'load']
        assert collections.Counter(e['id'] for e in loads) == {'/one': 1, '/two': 1}, loads
        if args.idle_seconds >= 335:
            switch(135)
            time.sleep(2)
            hover('hibernation wake', '/two')
            loads = [e for e in events if e['type'] == 'load']
            assert collections.Counter(e['id'] for e in loads) == {'/one': 1, '/two': 2}, loads
            waking = [e for e in loads if e['id'] == '/two']
            assert [e['count'] for e in waking] == [1, 2], waking
            assert waking[0]['boot'] != waking[1]['boot'], waking
        frames = [n for e in events if e['type'] == 'frames' and e['visibility'] == 'visible' for n in e['frames']]
        print('Loads:', loads, flush=True)
        print('Events:', dict(collections.Counter(e['type'] for e in events)), flush=True)
        print(f'Visible rAF: n={len(frames)} p50={statistics.median(frames):.1f}ms '
              f'p95={sorted(frames)[int(len(frames)*.95)]:.1f}ms max={max(frames):.1f}ms', flush=True)
        log.flush()
        trace = (output / 'app.log').read_text()
        assert 'geometry: view' in trace, 'missing allocation trace'
        assert not re.search(r'geometry: view \d+ \d+ 1 1\b', trace), 'intermediate 1×1 viewport'
        print('PASS', flush=True)
    finally:
        stop_samples.set()
        for process in reversed(processes):
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        server.shutdown()


if __name__ == '__main__':
    main()
