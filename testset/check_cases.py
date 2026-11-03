"""Check the test set is internally consistent: every cited source exists in the demo content,
and every reviewer probe (reviewer-probes.yaml) quotes its source verbatim.

Data check only (no agent logic). Run: python3 testset/check_cases.py
"""
import re
import sys
import unicodedata
from collections import Counter
from datetime import datetime
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
ROOM_DIRS = {"ledgerly-pilot": "ledgerly", "riverside-build-night": "riverside"}
VERDICTS = {"covered", "might-be-related", "parked", "new", "contradicts-record", "decision", "reopen", "parked-recall"}
RESTRICTIONS = {"personal", "project", "not-a-restriction"}


def when(ts) -> datetime:
    """YAML gives aware datetimes for ISO stamps; compare those, not strings (offsets differ)."""
    return ts if isinstance(ts, datetime) else datetime.fromisoformat(str(ts))


def sections(doc: Path) -> set[str]:
    return set(re.findall(r"^## (§\d+)", doc.read_text(), re.M))


def normalise(text: str) -> str:
    """The eval's normalisation (eval-harness.md §5): NFKC, lowercase, strip *_ backticks and quotes, collapse whitespace."""
    text = unicodedata.normalize("NFKC", text).lower()
    text = re.sub("[*_`'\"\u2018\u2019\u201c\u201d]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def section_text(doc: Path, sec: str) -> str:
    """A section's text, from its heading to the next `## `."""
    m = re.search(rf"^## {sec}\b.*?(?=^## |\Z)", doc.read_text(), re.M | re.S)
    return m.group(0) if m else ""


def check_probes(errors: list) -> Counter:
    """P7 reviewer probes: every quote is verbatim (after normalising) in the source it names."""
    probes = yaml.safe_load((ROOT / "testset/reviewer-probes.yaml").read_text())["probes"]
    ids = Counter(p["id"] for p in probes)
    errors += [f"{i}: duplicate probe id" for i, n in ids.items() if n > 1]
    for p in probes:
        ref, where = p["quote_ref"], p["id"]
        if p.get("expect") not in {"pass", "block"} or not p.get("claim") or not p.get("why"):
            errors.append(f"{where}: needs claim, why and expect pass|block")
        if ref.startswith(("led-", "riv-")):
            room_dir = ROOT / "demo" / ("ledgerly" if ref.startswith("led-") else "riverside")
            msgs = {m["id"]: m["text"] for m in yaml.safe_load((room_dir / "chat-history.yaml").read_text())["messages"]}
            source = msgs.get(ref, "")
        else:
            doc, sec = ref.split(" ")
            paths = sorted((ROOT / "demo").glob(f"*/docs/{doc}"))
            source = section_text(paths[0], sec) if paths else ""
        quote = normalise(p["quote"])
        if not source:
            errors.append(f"{where}: unknown source {ref}")
        elif len(quote) < 12:
            errors.append(f"{where}: quote shorter than 12 characters after normalising")
        elif quote not in normalise(source):
            errors.append(f"{where}: quote is not verbatim in {ref}")
    if len(probes) < 12:
        errors.append(f"only {len(probes)} reviewer probes (need at least 12)")
    return Counter(p["expect"] for p in probes)


def main() -> int:
    cases = yaml.safe_load((ROOT / "testset/cases.yaml").read_text())["cases"]
    # Blind cases (holdout, red team): same checks, so each one is answerable from the record.
    for extra in [ROOT / "testset/holdout/holdout.yaml", *sorted((ROOT / "testset/redteam").glob("*.yaml"))]:
        if extra.exists():
            cases += yaml.safe_load(extra.read_text())["cases"]
    errors = []
    for c in cases:
        room_dir = ROOT / "demo" / ROOM_DIRS[c["room"]]
        history = yaml.safe_load((room_dir / "chat-history.yaml").read_text())
        msg_at = {m["id"]: m["at"] for m in history["messages"]}
        msg_ids = set(msg_at)
        e = c["expect"]
        if e["job"] in {"A", "B"} and e.get("verdict") not in VERDICTS:
            errors.append(f"{c['id']}: bad verdict {e.get('verdict')}")
        if e["job"] == "D" and e.get("restriction") not in RESTRICTIONS:
            errors.append(f"{c['id']}: bad restriction {e.get('restriction')}")
        for src in e.get("sources", []) + e.get("also_sources", []):
            if src.startswith(("led-", "riv-")):
                if src not in msg_ids:
                    errors.append(f"{c['id']}: unknown message {src}")
                elif when(msg_at[src]) >= when(c["at"]):
                    errors.append(f"{c['id']}: cites {src}, which is not before the case")
                continue
            doc, sec = src.split(" ")
            path = room_dir / "docs" / doc
            if not path.exists():
                errors.append(f"{c['id']}: missing doc {doc}")
            elif sec not in sections(path):
                errors.append(f"{c['id']}: {doc} has no {sec}")
        if e.get("verdict") in {"covered", "parked", "contradicts-record", "might-be-related", "reopen", "parked-recall"} and not e.get("sources"):
            errors.append(f"{c['id']}: {e['verdict']} needs at least one source (trust rule)")

    probe_mix = check_probes(errors)

    print("\n".join(errors) or "OK: all sources resolve, all probe quotes verbatim")
    print(f"{sum(probe_mix.values())} reviewer probes:", dict(sorted(probe_mix.items())))
    mix = Counter(c["expect"].get("verdict") or c["expect"].get("restriction") or "quiet" for c in cases)
    print(f"{len(cases)} cases:", dict(sorted(mix.items())))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
