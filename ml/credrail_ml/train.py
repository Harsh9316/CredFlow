"""Train, evaluate and export a probability-of-default model.

    python -m credrail_ml.train --dataset uci-taiwan
    python -m credrail_ml.train --dataset csv --path loans.csv --target defaulted \\
        --name india-icai --title "..." --source "..." --license "..." --exclude id gender

Writes ml/models/<name>.json (read by the Credrail engine) and
ml/reports/<name>.md (metrics, calibration, top drivers).
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score, roc_curve
from sklearn.model_selection import StratifiedKFold, train_test_split

from . import datasets
from .features import DatasetSpec, build_features
from .model import SCHEMA, predict_proba

ROOT = Path(__file__).resolve().parent.parent
SEED = 42
C_GRID = [0.003, 0.01, 0.03, 0.1, 0.3, 1.0]


# ── Metrics ──

def ks_stat(y: np.ndarray, p: np.ndarray) -> float:
    fpr, tpr, _ = roc_curve(y, p)
    return float(np.max(tpr - fpr))


def metrics(y: np.ndarray, p: np.ndarray) -> dict:
    auc = roc_auc_score(y, p)
    return {
        "n": int(len(y)),
        "defaultRate": round(float(np.mean(y)), 4),
        "auc": round(float(auc), 4),
        "gini": round(float(2 * auc - 1), 4),
        "ks": round(ks_stat(y, p), 4),
        "brier": round(float(brier_score_loss(y, p)), 4),
    }


def calibration_table(y: np.ndarray, p: np.ndarray, bins: int = 10) -> list[dict]:
    df = pd.DataFrame({"y": y, "p": p})
    df["decile"] = pd.qcut(df["p"].rank(method="first"), bins, labels=False) + 1
    g = df.groupby("decile").agg(n=("y", "size"), predicted=("p", "mean"), actual=("y", "mean"))
    return [
        {"decile": int(d), "n": int(r.n), "predicted": round(float(r.predicted), 4), "actual": round(float(r.actual), 4)}
        for d, r in g.iterrows()
    ]


# ── Logistic regression on hand-built design matrix (so it can be exported) ──

class Design:
    """Clip, standardise and one-hot encode, remembering the training statistics."""

    def __init__(self, specs, X: pd.DataFrame):
        self.specs = specs
        self.numeric = {}
        self.categorical = {}
        for s in specs:
            col = X[s.name]
            if s.categorical:
                counts = col.value_counts()
                self.categorical[s.name] = [lvl for lvl, n in counts.items() if n >= 30]
            else:
                lo, hi = np.nanpercentile(col, [1, 99])
                clipped = col.clip(lo, hi)
                mean = float(clipped.mean())
                std = float(clipped.std(ddof=0)) or 1.0
                self.numeric[s.name] = {"clip": [float(lo), float(hi)], "mean": mean, "std": std}

    def columns(self) -> list[tuple[str, str | None]]:
        cols: list[tuple[str, str | None]] = []
        for s in self.specs:
            if s.categorical:
                cols += [(s.name, lvl) for lvl in self.categorical[s.name]]
            else:
                cols.append((s.name, None))
        return cols

    def transform(self, X: pd.DataFrame) -> np.ndarray:
        parts = []
        for s in self.specs:
            col = X[s.name]
            if s.categorical:
                for lvl in self.categorical[s.name]:
                    parts.append((col == lvl).astype(float).to_numpy())
            else:
                st = self.numeric[s.name]
                z = (col.clip(*st["clip"]) - st["mean"]) / st["std"]
                parts.append(z.fillna(0.0).to_numpy())
        return np.column_stack(parts)


def fit_logreg(D: Design, X: pd.DataFrame, y: np.ndarray) -> tuple[LogisticRegression, dict]:
    Z = D.transform(X)
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    cv: dict[float, list[float]] = {}
    for C in C_GRID:
        scores = []
        for tr, va in skf.split(Z, y):
            m = LogisticRegression(C=C, max_iter=5000)
            m.fit(Z[tr], y[tr])
            scores.append(roc_auc_score(y[va], m.predict_proba(Z[va])[:, 1]))
        cv[C] = scores
    best_c = max(cv, key=lambda c: np.mean(cv[c]))
    model = LogisticRegression(C=best_c, max_iter=5000).fit(Z, y)
    summary = {"C": best_c, "cvAucMean": round(float(np.mean(cv[best_c])), 4),
               "cvAucStd": round(float(np.std(cv[best_c])), 4)}
    return model, summary


def export(spec: DatasetSpec, D: Design, lr: LogisticRegression, X_train: pd.DataFrame,
           bands: dict, test_metrics: dict, extra: dict) -> dict:
    coefs = dict(zip(D.columns(), lr.coef_[0]))
    features = []
    for s in spec.features:
        base = {"name": s.name, "label": s.label, "source": s.source()}
        if s.categorical:
            levels = {lvl: float(coefs[(s.name, lvl)]) for lvl in D.categorical[s.name]}
            freq = X_train[s.name].value_counts(normalize=True)
            # Levels outside the kept set carry a coefficient of 0 in the design.
            baseline = float(sum(levels.get(lvl, 0.0) * share for lvl, share in freq.items()))
            features.append({**base, "kind": "categorical", "levels": levels, "baseline": baseline})
        else:
            st = D.numeric[s.name]
            features.append({**base, "kind": "numeric", **st, "coef": float(coefs[(s.name, None)])})
    # Fold the centring of categorical contributions into the intercept so that
    # intercept + sum(contributions) reproduces sklearn exactly.
    intercept = float(lr.intercept_[0]) + sum(f["baseline"] for f in features if f["kind"] == "categorical")
    return {
        "schema": SCHEMA,
        "id": f"{spec.name}-logreg",
        "version": date.today().isoformat(),
        "algorithm": "logistic-regression",
        "advisoryOnly": True,
        "dataset": {"name": spec.name, "title": spec.title, "source": spec.source,
                    "license": spec.license, "excludedColumns": spec.excluded},
        "intercept": intercept,
        "features": features,
        "bands": bands,
        "metrics": {"test": test_metrics, **extra},
    }


def report(model: dict, gbm_metrics: dict, calib: list[dict], cv: dict, n_train: int) -> str:
    m = model["metrics"]["test"]
    ds = model["dataset"]
    lines = [
        f"# Probability-of-default model: {ds['title']}",
        "",
        f"Generated by `python -m credrail_ml.train` on {model['version']}. Advisory only: Credrail shows this next to the",
        "policy decision and never uses it to approve or reject.",
        "",
        f"- **Data:** [{ds['title']}]({ds['source']}), {ds['license']}. {n_train:,} training rows, {m['n']:,} test rows (stratified 80/20 split, seed {SEED}).",
        f"- **Excluded columns:** {', '.join(ds['excludedColumns']) or 'none'}.",
        f"- **Model:** logistic regression, L2, C = {cv['C']} chosen by 5-fold cross-validated AUC "
        f"({cv['cvAucMean']} ± {cv['cvAucStd']}).",
        "",
        "## Test-set performance",
        "",
        "| Model | AUC | Gini | KS | Brier |",
        "|---|---|---|---|---|",
        f"| Logistic regression (exported) | {m['auc']} | {m['gini']} | {m['ks']} | {m['brier']} |",
        f"| Gradient boosting (benchmark, not exported) | {gbm_metrics['auc']} | {gbm_metrics['gini']} | {gbm_metrics['ks']} | {gbm_metrics['brier']} |",
        "",
        f"Test default rate: {m['defaultRate']:.1%}. Risk bands: LOW below {model['bands']['medium']:.1%}, "
        f"HIGH at or above {model['bands']['high']:.1%}.",
        "",
        "## Calibration (test set, by predicted-risk decile)",
        "",
        "| Decile | Accounts | Predicted default rate | Actual default rate |",
        "|---|---|---|---|",
    ]
    lines += [f"| {c['decile']} | {c['n']} | {c['predicted']:.1%} | {c['actual']:.1%} |" for c in calib]
    lines += ["", "## Strongest numeric drivers (standardised coefficients)", "",
              "| Feature | Coefficient | Effect |", "|---|---|---|"]
    numeric = [f for f in model["features"] if f["kind"] == "numeric"]
    for f in sorted(numeric, key=lambda f: -abs(f["coef"]))[:10]:
        lines.append(f"| {f['label']} | {f['coef']:+.3f} | {'raises' if f['coef'] > 0 else 'lowers'} default risk |")
    lines += ["", "## Limitations", "",
              "- Trained on one lender's historical portfolio. Retrain and validate on your own book before relying on it.",
              "- Probabilities describe the training population and drift as conditions change; monitor calibration.",
              "- Not a substitute for the policy engine, credit judgement or regulatory model-risk review."]
    return "\n".join(lines) + "\n"


def run(df: pd.DataFrame, spec: DatasetSpec, out_dir: Path = ROOT) -> dict:
    y = pd.to_numeric(df[spec.target], errors="coerce")
    keep = y.isin([0, 1])
    df, y = df[keep], y[keep].astype(int).to_numpy()
    X = build_features(df, spec.features)

    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, stratify=y, random_state=SEED)
    D = Design(spec.features, X_tr)
    lr, cv = fit_logreg(D, X_tr, y_tr)
    p_te = lr.predict_proba(D.transform(X_te))[:, 1]
    lr_metrics = metrics(y_te, p_te)

    cat_mask = [s.categorical for s in spec.features]
    X_gbm_tr = X_tr.copy()
    X_gbm_te = X_te.copy()
    for s in spec.features:
        if s.categorical:
            cats = pd.Categorical(X_tr[s.name]).categories
            X_gbm_tr[s.name] = pd.Categorical(X_tr[s.name], categories=cats).codes
            X_gbm_te[s.name] = pd.Categorical(X_te[s.name], categories=cats).codes
    gbm = HistGradientBoostingClassifier(
        max_iter=300, learning_rate=0.05, early_stopping=True, random_state=SEED,
        categorical_features=cat_mask if any(cat_mask) else None,
    ).fit(X_gbm_tr, y_tr)
    gbm_metrics = metrics(y_te, gbm.predict_proba(X_gbm_te)[:, 1])

    p_tr = lr.predict_proba(D.transform(X_tr))[:, 1]
    bands = {"medium": round(float(np.quantile(p_tr, 0.6)), 4), "high": round(float(np.quantile(p_tr, 0.85)), 4)}
    model = export(spec, D, lr, X_tr, bands, lr_metrics,
                   {"crossValidation": cv, "benchmarkGradientBoosting": gbm_metrics})

    # The exported JSON must reproduce sklearn's probabilities.
    parity = float(np.max(np.abs(predict_proba(X_te, model) - p_te)))
    if parity > 1e-9:
        raise AssertionError(f"Exported model drifts from sklearn by {parity}")

    (out_dir / "models").mkdir(parents=True, exist_ok=True)
    (out_dir / "reports").mkdir(parents=True, exist_ok=True)
    (out_dir / "models" / f"{spec.name}.json").write_text(json.dumps(model, indent=2) + "\n")
    (out_dir / "reports" / f"{spec.name}.md").write_text(
        report(model, gbm_metrics, calibration_table(y_te, p_te), cv, len(y_tr)))
    write_parity_fixture(df, X_te, p_te, spec, out_dir / "models" / f"{spec.name}.parity.json")
    return model


def write_parity_fixture(df: pd.DataFrame, X_te: pd.DataFrame, p_te: np.ndarray,
                         spec: DatasetSpec, path: Path, n: int = 25) -> None:
    """Raw test rows and their probabilities, so the TypeScript scorer can prove it matches."""
    cols: list[str] = []
    for s in spec.features:
        for c in ([s.column] if s.op == "raw" else [s.numerator, s.denominator]):
            if c not in cols:
                cols.append(c)
    idx = X_te.index[:n]
    rows = json.loads(df.loc[idx, cols].to_json(orient="records"))
    path.write_text(json.dumps({"rows": rows, "probabilities": [float(p) for p in p_te[:n]]}, indent=1) + "\n")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", choices=["uci-taiwan", "csv"], required=True)
    ap.add_argument("--path", help="Local file (required for csv)")
    ap.add_argument("--target", help="0/1 default column (csv)")
    ap.add_argument("--name", help="Short id used for output files (csv)")
    ap.add_argument("--title", default="Custom loan dataset")
    ap.add_argument("--source", default="")
    ap.add_argument("--license", default="unknown")
    ap.add_argument("--exclude", nargs="*", default=[], help="Columns never used as features (IDs, protected traits)")
    a = ap.parse_args(argv)

    if a.dataset == "uci-taiwan":
        df, spec = datasets.load_uci_taiwan(a.path)
    else:
        if not (a.path and a.target and a.name):
            ap.error("--dataset csv needs --path, --target and --name")
        df = datasets.load_csv(a.path)
        spec = datasets.csv_spec(df, a.name, a.title, a.source, a.license, a.target, a.exclude)
    model = run(df, spec)
    t = model["metrics"]["test"]
    print(f"{spec.name}: AUC {t['auc']}  KS {t['ks']}  Brier {t['brier']}  "
          f"(gradient boosting AUC {model['metrics']['benchmarkGradientBoosting']['auc']})")


if __name__ == "__main__":
    main()
