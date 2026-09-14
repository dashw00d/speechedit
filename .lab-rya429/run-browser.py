import os, socket, subprocess, time, urllib.request
from pathlib import Path
root=Path(__file__).resolve().parent.parent
lab=root/'.lab-rya429'
with socket.socket() as sock:
 sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
env={**os.environ,'HOST':'127.0.0.1','PORT':str(port),'SPEECHEDIT_REVIEW_DIR':str(lab/'reviews'),'SPEECHEDIT_CACHE_DIR':str(lab/'cache'),'SPEECHEDIT_WEB_ROOT':os.environ.get('QA_WEB_ROOT', str(root/'src/renderer/dist')),'QA437_OUT':str(lab/os.environ.get('QA_OUTPUT', 'browser'))}
env.pop('ELECTRON_RUN_AS_NODE',None)
env['TMPDIR'] = os.environ.get('PAPERCLIP_RUN_SCRATCH_DIR', os.environ.get('PAPERCLIP_SCRATCH_DIR', str(lab)))
env.setdefault('DISPLAY', ':0')
auth=list(Path('/run/user/1000').glob('.mutter-Xwaylandauth.*'))
if auth: env.setdefault('XAUTHORITY',str(auth[0]))
with (lab/'service.log').open('w') as log:
 server=subprocess.Popen(['/home/ryan/.nvm/versions/node/v25.9.0/bin/bun','scripts/web-server.ts'],cwd=root,env=env,stdout=log,stderr=log)
 try:
  for i in range(100):
   try:
    urllib.request.urlopen(f'http://127.0.0.1:{port}',timeout=1);break
   except Exception: time.sleep(.1)
  result=subprocess.run([str(root/'node_modules/.bin/electron'),'--no-sandbox',str(lab/os.environ.get('QA_SCRIPT', 'qa437.cjs')),f'http://127.0.0.1:{port}'],cwd=root,env=env,timeout=150)
  raise SystemExit(result.returncode)
 finally:
  print('SERVICE_EXIT_BEFORE_CLEANUP',server.poll(),flush=True)
  server.terminate()
  try: server.wait(timeout=5)
  except subprocess.TimeoutExpired: server.kill();server.wait()
