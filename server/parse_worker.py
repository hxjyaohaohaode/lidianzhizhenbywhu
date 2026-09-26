"""Isolated document parser: bounded input on stdin, plain JSON on stdout."""
import json
import os
import sys

def main():
    if os.name!='nt':
        import resource
        resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,512*1024*1024))
        resource.setrlimit(resource.RLIMIT_CPU,(8,8))
        resource.setrlimit(resource.RLIMIT_FSIZE,(2*1024*1024,2*1024*1024))
    from .imports import document_text
    raw=sys.stdin.buffer.read(2000001)
    try:sys.stdout.write(json.dumps({'text':document_text(sys.argv[1],raw)},ensure_ascii=False))
    except Exception as exc:
        sys.stdout.write(json.dumps({'error':f'文档无法安全解析（{type(exc).__name__}）。'},ensure_ascii=False));sys.exit(2)
if __name__=='__main__':main()
