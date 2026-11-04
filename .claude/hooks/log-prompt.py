# UserPromptSubmit hook: append each prompt to blog/prompts.jsonl. Never blocks a prompt.
import datetime, json, os, pathlib, sys
try:
    d = json.load(sys.stdin)
    t = d.get("prompt", "")
    # CK_PROMPT_LOG lets a session started in another folder (the prep repo) log here too.
    p = pathlib.Path(os.environ.get("CK_PROMPT_LOG") or pathlib.Path(d.get("cwd") or ".") / "blog" / "prompts.jsonl")
    p.parent.mkdir(exist_ok=True)
    with p.open("a") as f:
        f.write(json.dumps({"ts": datetime.datetime.now().isoformat(timespec="seconds"),
                            "words": len(t.split()), "cwd": d.get("cwd", ""), "text": t}) + "\n")
except Exception:
    pass
sys.exit(0)
