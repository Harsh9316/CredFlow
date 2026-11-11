"""End-to-end checks on a small synthetic portfolio, so CI needs no downloads."""

import json

import numpy as np
import pandas as pd
import pytest

from credrail_ml import datasets
from credrail_ml.features import build_features
from credrail_ml.model import SCHEMA, band, contributions, predict_proba
from credrail_ml.train import run


def synthetic(n: int = 4000, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    utilization = rng.uniform(0, 1.2, n)
    late_months = rng.integers(0, 4, n)
    income = rng.lognormal(10, 0.5, n)
    region = rng.choice(["north", "south", "east", "west"], n)
    logit = -2.0 + 2.0 * utilization + 0.6 * late_months - 0.3 * np.log(income / 20000) + (region == "east") * 0.4
    default = (rng.uniform(size=n) < 1 / (1 + np.exp(-logit))).astype(int)
    return pd.DataFrame({
        "loan_id": np.arange(n), "gender": rng.choice(["F", "M"], n),
        "balance": utilization * 50000, "limit": 50000.0, "late_months": late_months,
        "income": income, "region": region, "defaulted": default,
    })


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    df = synthetic()
    spec = datasets.csv_spec(df, "synthetic", "Synthetic", "test", "CC0", "defaulted", ["loan_id", "gender"])
    out = tmp_path_factory.mktemp("out")
    return df, spec, run(df, spec, out_dir=out), out


def test_exported_model_shape(trained):
    _, spec, model, out = trained
    assert model["schema"] == SCHEMA
    assert model["advisoryOnly"] is True
    names = {f["name"] for f in model["features"]}
    assert "gender" not in names and "loan_id" not in names
    assert json.loads((out / "models" / "synthetic.json").read_text())["id"] == "synthetic-logreg"
    assert (out / "reports" / "synthetic.md").read_text().startswith("# Probability-of-default model")


def test_model_learns_the_signal(trained):
    _, _, model, _ = trained
    assert model["metrics"]["test"]["auc"] > 0.7
    coefs = {f["name"]: f.get("coef") for f in model["features"]}
    assert coefs["late_months"] > 0 and coefs["income"] < 0


def test_json_scoring_is_reproducible(trained):
    df, spec, model, _ = trained
    X = build_features(df.head(50), spec.features)
    p1, p2 = predict_proba(X, model), predict_proba(X, model)
    assert np.all((p1 > 0) & (p1 < 1)) and np.array_equal(p1, p2)


def test_missing_values_score_as_average(trained):
    _, _, model, _ = trained
    contrib = contributions({}, model)
    assert all(v == 0 for v in contrib.values())
    assert band(0.0, model) == "LOW" and band(1.0, model) == "HIGH"


def test_ratio_feature_handles_zero_denominator():
    df = pd.DataFrame({"a": [10.0, 5.0], "b": [0.0, 2.0]})
    spec = [datasets.FeatureSpec("r", "ratio", op="ratio", numerator="a", denominator="b")]
    assert build_features(df, spec)["r"].tolist() == [0.0, 2.5]
