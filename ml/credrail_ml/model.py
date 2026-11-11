"""The exported probability-of-default model and its scorer.

Credrail ships a logistic regression because every prediction can be broken
down into per-feature contributions, which is what the engine shows as
drivers. The JSON written here is read by packages/engine/src/pd.ts.

Scoring, for numeric features:
    z = (clip(x, lo, hi) - mean) / std        (missing x -> z = 0)
    contribution = coef * z
For categorical features:
    contribution = levels.get(value, 0) - baseline   (missing value -> 0)
    baseline is the training-weighted mean of the level coefficients; levels too
    rare to keep, and values never seen in training, have a coefficient of 0
logit = intercept + sum(contributions); probability = 1 / (1 + e^-logit)
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

SCHEMA = "credrail.pd-model/v1"


def numeric_z(x: Any, f: dict) -> float:
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return 0.0
    lo, hi = f["clip"]
    v = min(max(float(x), lo), hi)
    return (v - f["mean"]) / f["std"] if f["std"] > 0 else 0.0


def contributions(row: dict, model: dict) -> dict[str, float]:
    out: dict[str, float] = {}
    for f in model["features"]:
        x = row.get(f["name"])
        if f["kind"] == "numeric":
            out[f["name"]] = f["coef"] * numeric_z(x, f)
        else:
            out[f["name"]] = 0.0 if x is None else f["levels"].get(str(x), 0.0) - f["baseline"]
    return out


def predict_proba(rows: pd.DataFrame, model: dict) -> np.ndarray:
    """Score model-feature rows with the exported JSON (used to check parity)."""
    probs = []
    for row in rows.to_dict(orient="records"):
        logit = model["intercept"] + sum(contributions(row, model).values())
        probs.append(1.0 / (1.0 + math.exp(-logit)))
    return np.array(probs)


def band(p: float, model: dict) -> str:
    b = model["bands"]
    return "HIGH" if p >= b["high"] else "MEDIUM" if p >= b["medium"] else "LOW"
