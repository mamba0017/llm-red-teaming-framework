"""
Build a static, read-only, password-gated snapshot of the dashboard for Vercel.
=================================================================================
Bakes the current results/*.json into plain JSON files (no live backend, no
local-model access, no write endpoints) and assembles a deployable file tree
under dashboard/site_dist/, including a Basic Auth Edge Middleware.

Usage:
    .venv/bin/python dashboard/build_static_site.py
    # optionally pin the password instead of generating one:
    SITE_PASSWORD=mypassword .venv/bin/python dashboard/build_static_site.py

The output directory (site_dist/) is gitignored — it embeds the full raw
dataset plus the site password, and should only ever go to Vercel via the
deploy tool, never to the public GitHub repo.
"""

import json
import os
import secrets
import shutil
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
RESULTS_DIR = PROJECT_ROOT / "results"
DATASET_PATH = PROJECT_ROOT / "prompts" / "minor_persona_dataset.json"
SITE_SRC = Path(__file__).parent / "static_site"
OUT_DIR = Path(__file__).parent / "site_dist"

CATEGORIES = [
    "age_inappropriate_content",
    "grooming_simulation",
    "parental_control_bypass",
    "personal_info_elicitation",
    "self_harm_suicide",
    "dangerous_challenges",
    "stranger_meeting",
    "authority_manipulation",
]
SEVERITY_ORDER = ["critical", "high", "medium", "low"]


def _category_label(cat: str) -> str:
    return cat.replace("_", " ").title()


def compute_summary(records):
    evaluated = [r for r in records if r.get("evaluation_score") is not None]

    score_distribution = {"safe": 0, "partial": 0, "unsafe": 0}
    for r in evaluated:
        score_distribution[{0: "safe", 1: "partial", 2: "unsafe"}[r["evaluation_score"]]] += 1

    by_category = []
    for cat in CATEGORIES:
        cat_all = [r for r in records if r["category"] == cat]
        cat_eval = [r for r in cat_all if r.get("evaluation_score") is not None]
        mean_score = sum(r["evaluation_score"] for r in cat_eval) / len(cat_eval) if cat_eval else None
        by_category.append(
            {
                "category": cat,
                "label": _category_label(cat),
                "total": len(cat_all),
                "evaluated": len(cat_eval),
                "safe": sum(1 for r in cat_eval if r["evaluation_score"] == 0),
                "partial": sum(1 for r in cat_eval if r["evaluation_score"] == 1),
                "unsafe": sum(1 for r in cat_eval if r["evaluation_score"] == 2),
                "mean_score": mean_score,
            }
        )

    by_severity = []
    for sev in SEVERITY_ORDER:
        sev_eval = [r for r in evaluated if r["severity"] == sev]
        success_rate = (
            (sum(1 for r in sev_eval if r["evaluation_score"] > 0) / len(sev_eval)) * 100 if sev_eval else None
        )
        by_severity.append({"severity": sev, "total": len(sev_eval), "success_rate": success_rate})

    technique_scores = {}
    for r in evaluated:
        technique_scores.setdefault(r["attack_technique"], []).append(r["evaluation_score"])
    by_technique = sorted(
        (
            {"technique": t, "label": _category_label(t), "mean_score": sum(v) / len(v), "count": len(v)}
            for t, v in technique_scores.items()
        ),
        key=lambda x: x["mean_score"],
        reverse=True,
    )[:15]

    latencies = [r["latency_ms"] for r in records if r.get("latency_ms")]
    latency = (
        {"mean": sum(latencies) // len(latencies), "min": min(latencies), "max": max(latencies)}
        if latencies
        else None
    )

    return {
        "total": len(records),
        "evaluated": len(evaluated),
        "errors": sum(1 for r in records if r.get("error")),
        "score_distribution": score_distribution,
        "by_category": by_category,
        "by_severity": by_severity,
        "by_technique": by_technique,
        "latency": latency,
    }


def build_data(out_data_dir: Path):
    out_data_dir.mkdir(parents=True, exist_ok=True)
    (out_data_dir / "results").mkdir(exist_ok=True)
    (out_data_dir / "summary").mkdir(exist_ok=True)

    results_index = []
    for path in sorted(RESULTS_DIR.glob("*_results.json")):
        with open(path) as f:
            records = json.load(f)
        model_name = path.name[: -len("_results.json")]

        with open(out_data_dir / "results" / f"{model_name}.json", "w") as f:
            json.dump(records, f, ensure_ascii=False)

        summary = compute_summary(records)
        with open(out_data_dir / "summary" / f"{model_name}.json", "w") as f:
            json.dump(summary, f, ensure_ascii=False)

        results_index.append(
            {
                "model": model_name,
                "total": len(records),
                "evaluated": summary["evaluated"],
                "errors": summary["errors"],
            }
        )

    with open(out_data_dir / "results-index.json", "w") as f:
        json.dump(results_index, f, ensure_ascii=False)

    with open(out_data_dir / "meta.json", "w") as f:
        json.dump(
            {
                "categories": [{"id": c, "label": _category_label(c)} for c in CATEGORIES],
                "severities": SEVERITY_ORDER,
                "generated_at": datetime.now().isoformat(),
            },
            f,
            ensure_ascii=False,
        )

    return results_index


MIDDLEWARE_JS = """\
import {{ next }} from '@vercel/functions';

const REALM = 'Red Team Dashboard';
const USER = {user!r};
const PASS = {password!r};

function timingSafeEqual(a, b) {{
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}}

export default function middleware(request) {{
  const auth = request.headers.get('authorization') || '';
  const [scheme, encoded] = auth.split(' ');

  if (scheme === 'Basic' && encoded) {{
    try {{
      const decoded = atob(encoded);
      const sep = decoded.indexOf(':');
      const user = decoded.slice(0, sep);
      const pass = decoded.slice(sep + 1);
      if (timingSafeEqual(user, USER) && timingSafeEqual(pass, PASS)) {{
        return next();
      }}
    }} catch (e) {{
      // fall through to 401
    }}
  }}

  return new Response('Authentication required', {{
    status: 401,
    headers: {{ 'WWW-Authenticate': `Basic realm="${{REALM}}"` }},
  }});
}}
"""

PACKAGE_JSON = """\
{
  "name": "redteam-dashboard-snapshot",
  "private": true,
  "type": "module",
  "dependencies": {
    "@vercel/functions": "^1.5.0"
  }
}
"""

ROBOTS_TXT = "User-agent: *\nDisallow: /\n"


def assemble_site(password: str, user: str = "redteam"):
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True)

    for name in ("index.html", "app.js", "style.css"):
        shutil.copy(SITE_SRC / name, OUT_DIR / name)

    results_index = build_data(OUT_DIR / "data")

    (OUT_DIR / "middleware.js").write_text(MIDDLEWARE_JS.format(user=user, password=password))
    (OUT_DIR / "package.json").write_text(PACKAGE_JSON)
    (OUT_DIR / "robots.txt").write_text(ROBOTS_TXT)

    return results_index


def main():
    password = os.environ.get("SITE_PASSWORD") or secrets.token_urlsafe(12)
    user = os.environ.get("SITE_USER", "redteam")

    results_index = assemble_site(password=password, user=user)

    print("=" * 60)
    print("STATIC SITE BUILT")
    print("=" * 60)
    print(f"  Output dir: {OUT_DIR}")
    for r in results_index:
        print(f"    {r['model']}: {r['total']} results ({r['evaluated']} evaluated)")
    print("-" * 60)
    print(f"  Basic Auth user:     {user}")
    print(f"  Basic Auth password: {password}")
    print("  (save this — it is not printed again unless you rerun with SITE_PASSWORD set)")
    print("=" * 60)


if __name__ == "__main__":
    main()
