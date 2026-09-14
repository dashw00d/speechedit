import sys,os,socket,subprocess,pathlib,urllib.request,time
root=pathlib.Path.cwd(); lab=root/'.lab-rya334'; port=3384
for name,dist in [('candidate-corrected',root/'src/renderer/dist'),('baseline-corrected',pathlib.Path('/home/ryan/dev/speechedit-qa336-builder/src/renderer/dist'))]:
 port = 3384 if name.startswith('candidate') else 3385
 if len(sys.argv)>1 and sys.argv[1] not in name: continue
 s=socket.socket();s.bind(('127.0.0.1',port));s.close()
 env=os.environ.copy();env.update(HOST='127.0.0.1',PORT=str(port),SPEECHEDIT_REVIEW_DIR=str(lab/name/'reviews'),SPEECHEDIT_WEB_ROOT=str(dist),SPEECHEDIT_CACHE_DIR=str(lab/name/'cache'))
 (lab/name).mkdir(parents=True,exist_ok=True)
 with open(lab/name/'service.log','w') as log:
  p=subprocess.Popen(['bun','scripts/web-server.ts'],env=env,stdout=log,stderr=log)
  try:
   for _ in range(30):
    try: urllib.request.urlopen(f'http://127.0.0.1:{port}/healthz');break
    except Exception: time.sleep(.2)
   with open(lab/name/'suite.log','w') as output:
    r=subprocess.run(['bash','.lab-rya334/run-suite.sh',f'http://127.0.0.1:{port}',str(lab/name)],stdout=output,stderr=output)
   print(name,'SUITE_EXIT',r.returncode,flush=True)
  finally:
   p.terminate();p.wait(timeout=10);print('OWN_SERVICE_EXIT',p.returncode,flush=True)
   try: urllib.request.urlopen(f'http://127.0.0.1:{port}/healthz'); print('PORT_STILL_RESPONDS')
   except Exception: print('PORT_CLOSED_CONFIRMED',flush=True)
