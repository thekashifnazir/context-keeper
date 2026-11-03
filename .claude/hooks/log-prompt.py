# UserPromptSubmit hook: append each prompt to blog/prompts.jsonl. Never blocks a prompt.
import datetime, json, pathlib, sys
try:
    d = json.load(sys.stdin)
    t = d.get("prompt", "")
    p = pathlib.Path(d.get("cwd") or ".") / "blog" / "prompts.jsonl"
    p.parent.mkdir(exist_ok=True)
    with p.open("a") as f:
        f.write(json.dumps({"ts": datetime.datetime.now().isoformat(timespec="seconds"),
                            "words": len(t.split()), "text": t}) + "\n")
except Exception:
    pass
sys.exit(0)
