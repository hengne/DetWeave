import argparse
import json
from pathlib import Path
from .model import validate


def main():
    parser=argparse.ArgumentParser(description="DetWeave detector geometry workbench")
    commands=parser.add_subparsers(dest="command",required=True)
    server=commands.add_parser("serve",help="Start loopback-only browser workbench")
    server.add_argument("--port",type=int,default=8765)
    check=commands.add_parser("validate",help="Check model schema, evidence and supported geometry")
    check.add_argument("model",type=Path)
    export=commands.add_parser("export",help="Write a reproducible project ZIP")
    export.add_argument("model",type=Path)
    export.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    if args.command=="serve":
        from .server import serve
        serve(args.port);return
    try:
        model=json.loads(args.model.read_text())
        result=validate(model)
        if args.command=="validate":
            print(json.dumps(result,indent=2,ensure_ascii=False));raise SystemExit(0 if result["ready"] else 1)
        from .exporters import project_zip
        data=project_zip(model)
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_bytes(data)
        print(f"Wrote {args.output} ({len(data)} bytes). Backend runtime validation: not run.")
    except (ValueError,OSError) as exc:
        parser.exit(2,f"DetWeave: {exc}\n")

if __name__=="__main__":main()
