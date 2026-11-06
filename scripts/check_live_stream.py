#!/usr/bin/env python3
"""Exercise the local NDJSON endpoint with Ark. Never saves reasoning or credentials."""
import argparse
import getpass
import json
from pathlib import Path
import time
import urllib.request


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--server',default='http://127.0.0.1:8765')
    p.add_argument('--output',type=Path,default=Path('local/stream-regression'))
    p.add_argument('--thinking',choices=['enabled','disabled','auto'])
    args=p.parse_args()
    key=getpass.getpass('Test API key (not saved): ')
    text='合成测试会议：世界是400×400×400 mm的G4_AIR盒，位于原点。做20个钨/聚苯乙烯周期，钨G4_W每片1 mm厚，聚苯乙烯G4_POLYSTYRENE每片5 mm厚，横向100×100 mm，沿z连续叠放，整个叠层中心位于原点，无间隙。但是总厚度必须不超过100 mm。不要擅自更改任何一项，遇到冲突请提问。'
    provider=dict(kind='openai',base_url='https://ark.cn-beijing.volces.com/api/coding/v3',model='ark-code-latest',api_key=key,total_timeout_s=600)
    if args.thinking:provider['thinking']=args.thinking
    body=json.dumps(dict(text=text,provider=provider)).encode()
    request=urllib.request.Request(args.server+'/api/extract/stream',data=body,headers={'Content-Type':'application/json','X-DetWeave':'1'})
    start=time.monotonic();stats={'first_event_s':{},'events':{},'characters':{}};result=None
    last_print=0
    with urllib.request.urlopen(request,timeout=620) as response:
        for line in response:
            if not line.strip():continue
            event=json.loads(line);kind=event['type'];elapsed=round(time.monotonic()-start,2)
            first=kind not in stats['first_event_s']
            stats['first_event_s'].setdefault(kind,elapsed)
            stats['events'][kind]=stats['events'].get(kind,0)+1
            if kind in ('reasoning','output'):
                stats['characters'][kind]=stats['characters'].get(kind,0)+len(event.get('text',''))
            if kind=='status':print(json.dumps({'stage':event.get('stage'),'elapsed_s':elapsed},ensure_ascii=False),flush=True)
            elif first or elapsed-last_print>=20:
                print(json.dumps({'event':kind,'elapsed_s':elapsed,'characters':stats['characters']},ensure_ascii=False),flush=True);last_print=elapsed
            if kind=='error':stats['error']={k:event.get(k) for k in ('code','message')};break
            if kind=='result':result=event['result'];break
    stats['elapsed_s']=round(time.monotonic()-start,2)
    stats['thinking_requested']=args.thinking or 'provider_default'
    stats['passed']=bool(result and result['model'].get('questions') and not result['report']['ready'])
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'summary.json').write_text(json.dumps(stats,indent=2,ensure_ascii=False)+'\n')
    if result:(args.output/'result.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps(stats,ensure_ascii=False),flush=True)
    raise SystemExit(0 if stats['passed'] else 1)

if __name__=='__main__':main()
