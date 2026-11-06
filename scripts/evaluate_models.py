#!/usr/bin/env python3
"""Small live extraction benchmark. Reads key from env or non-echoing terminal input.

Only synthetic fixture text is sent. Never logs credentials or full provider error bodies.
A case pass is a narrow acceptance check, not a general model-quality score.
"""
import argparse
from collections import Counter
import getpass
import json
import os
from pathlib import Path
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from detweave.providers import extract,ProviderError
from detweave.model import validate

ROOT=Path(__file__).resolve().parents[1]


def fingerprint(items):
    result=[]
    for p in items:
        s=p['shape']
        dims=s['size_mm'] if s['type']=='box' else [s['rmin_mm'],s['rmax_mm'],s['length_mm']]
        result.append((p['material'],s['type'],tuple(round(float(x),8) for x in dims),tuple(round(float(x),8) for x in p['global_mm'])))
    return Counter(result)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url',required=True)
    parser.add_argument('--models',nargs='+',default=['ark-code-latest'])
    parser.add_argument('--thinking',choices=['enabled','disabled','auto'])
    parser.add_argument('--cases',nargs='+',default=['sampling','chinese','conflict','missing'])
    parser.add_argument('--output',type=Path,default=Path('local/live-evaluation'))
    args=parser.parse_args()
    key=os.getenv('DETWEAVE_TEST_API_KEY') or getpass.getpass('Test API key (not saved): ')
    args.output.mkdir(parents=True,exist_ok=True)
    sample=json.loads((ROOT/'examples/sampling.json').read_text())
    chinese='这是合成测试装置。我们先做四个钨硅周期，世界是200毫米见方的空气盒，材料G4_AIR，以全局原点为中心。钨片用G4_W，完整尺寸80×60×1毫米；硅片用G4_Si，完整尺寸80×60×2毫米。所有片直接放在world里，x和y坐标都为0。第一片钨的中心z=-5.5毫米，第一片硅z=-4毫米；两种片分别重复4次，步长都是(0,0,3)毫米。没有旋转，不需要敏感体或光学配置。'
    cases={'sampling':sample['source_text'],'chinese':chinese,
           'conflict':'合成测试会议：世界是400×400×400 mm的G4_AIR盒，位于原点。做20个钨/聚苯乙烯周期，钨G4_W每片1 mm厚，聚苯乙烯G4_POLYSTYRENE每片5 mm厚，横向100×100 mm，沿z连续叠放，整个叠层中心位于原点，无间隙。但是总厚度必须不超过100 mm。不要擅自更改任何一项，遇到冲突请提问。',
           'missing':'讨论记录：想做十几层钨板和硅片，厚度先按5，横向大概100见方。先不定单位、层数、各层间隙、世界尺寸和摆放位置。请把未决定的事项列出来，不能擅自认定。'}
    expected=fingerprint(validate(sample)['instances'])
    summary=[]
    for model_name in args.models:
        for name in args.cases:
            start=time.monotonic();record={'requested_model':model_name,'case':name}
            try:
                model,provenance=extract(cases[name],dict(kind='openai',base_url=args.base_url,model=model_name,api_key=key,thinking=args.thinking))
                report=validate(model)
                if name in ('sampling','chinese'):
                    matched=fingerprint(report['instances'])==expected and model.get('world')==sample['world']
                    passed=matched and report['ready']
                    record.update(geometry_matches_reference=matched,exportable=report['ready'])
                else:
                    passed=not report['ready'] and bool(model.get('questions'))
                    record.update(clarification_present=bool(model.get('questions')),export_blocked=not report['ready'])
                record.update(passed=passed,provenance=provenance,issues=[dict(code=i['code'],message=i['message']) for i in report['issues']],instance_count=len(report['instances']))
                (args.output/f'{model_name}-{name}.json').write_text(json.dumps(dict(model=model,report=report,provenance=provenance),ensure_ascii=False,indent=2)+'\n')
            except (ProviderError,ValueError,KeyError) as exc:
                record.update(passed=False,error=str(exc))
            record['elapsed_s']=round(time.monotonic()-start,2)
            summary.append(record)
            (args.output/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
            print(json.dumps({k:v for k,v in record.items() if k not in ('issues','provenance')},ensure_ascii=False),flush=True)
    print(f'Results: {sum(r["passed"] for r in summary)}/{len(summary)} narrow cases passed; see {args.output}',flush=True)

if __name__=='__main__':main()
