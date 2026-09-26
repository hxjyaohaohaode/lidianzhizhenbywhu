"""Narrow explainable checks; not an exhaustive vulnerability scanner."""
from pathlib import Path
import ast,json,re
ROOT=Path(__file__).resolve().parents[1]
def main():
    findings=[];files=[]
    for folder in ('server','web','scripts'):
        for p in sorted((ROOT/folder).rglob('*')):
            if not p.is_file() or p.suffix not in ('.py','.ts','.js','.html','.css') or '__pycache__' in p.parts or 'dist' in p.parts:continue
            text=p.read_text(encoding='utf-8');files.append(str(p.relative_to(ROOT)))
            if p.name=='source_guard.py':continue
            if re.search(r'(?<![A-Za-z])sk-[A-Za-z0-9]{24,}',text):findings.append(str(p)+': possible embedded API key')
            if p.suffix=='.py':
                for node in ast.walk(ast.parse(text)):
                    if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id in ('eval','exec'):findings.append(str(p)+': dynamic execution')
                    if isinstance(node,ast.Call) and any(k.arg=='shell' and isinstance(k.value,ast.Constant) and k.value.value is True for k in node.keywords):findings.append(str(p)+': shell=True')
            if p.suffix in ('.ts','.js'):
                if re.search(r'Math\.random\s*\(',text):findings.append(str(p)+': random display data')
                if re.search(r'localStorage\.(?:setItem|getItem)',text):findings.append(str(p)+': localStorage requires security review')
    for p in (ROOT/'.env',ROOT/'deploy/.htpasswd'):
        if p.exists():findings.append(str(p)+': private file in release directory')
    result={'files_scanned':len(files),'files':files,'findings':findings,'scope':'AST and pattern guard only; not a vulnerability certification'}
    (ROOT/'evidence').mkdir(exist_ok=True);(ROOT/'evidence/source-guard.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result,ensure_ascii=False,indent=2));return bool(findings)
if __name__=='__main__':raise SystemExit(main())
