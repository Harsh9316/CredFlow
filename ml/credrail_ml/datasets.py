"""Dataset loaders.

uci-taiwan  Default of credit card clients (Yeh & Lien, 2009). 30,000 accounts,
            CC BY 4.0, downloaded from the UCI repository on first use.
csv         Any CSV with a 0/1 default column, for example the Indian datasets in
            ml/README.md. You download those yourself (Kaggle needs a login).
"""

from __future__ import annotations

import hashlib
import io
import urllib.request
import zipfile
from pathlib import Path

import pandas as pd

from .features import DatasetSpec, FeatureSpec

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

UCI_TAIWAN_URL = "https://archive.ics.uci.edu/static/public/350/default+of+credit+card+clients.zip"
UCI_TAIWAN_SHA256 = "30c6be3abd8dcfd3e6096c828bad8c2f011238620f5369220bd60cfc82700933"

# Columns that must never drive a credit decision. Sex and marital status are
# protected characteristics; age and education are left out as well so the
# model only learns from credit behaviour.
TAIWAN_EXCLUDED = ["ID", "SEX", "MARRIAGE", "AGE", "EDUCATION"]

_STATUS_LABEL = {
    0: "last month", 2: "2 months ago", 3: "3 months ago",
    4: "4 months ago", 5: "5 months ago", 6: "6 months ago",
}


def _taiwan_features() -> list[FeatureSpec]:
    f = [FeatureSpec("LIMIT_BAL", "Credit limit", column="LIMIT_BAL")]
    for m in (0, 2, 3, 4, 5, 6):
        # Status codes are categories, not a scale: -2 no balance, -1 paid in full,
        # 0 revolving credit, 1-8 months late.
        f.append(FeatureSpec(f"PAY_{m}", f"Repayment status, {_STATUS_LABEL[m]}", column=f"PAY_{m}", categorical=True))
    f.append(FeatureSpec("BILL_AMT1", "Latest statement balance", column="BILL_AMT1"))
    f.append(FeatureSpec("PAY_AMT1", "Latest payment amount", column="PAY_AMT1"))
    f.append(FeatureSpec(
        "UTILIZATION_1", "Credit utilisation, latest statement",
        op="ratio", numerator="BILL_AMT1", denominator="LIMIT_BAL",
    ))
    for m in (1, 2, 3):
        f.append(FeatureSpec(
            f"PAYMENT_RATIO_{m}", f"Share of statement {m} paid",
            op="ratio", numerator=f"PAY_AMT{m}", denominator=f"BILL_AMT{m}",
        ))
    return f


UCI_TAIWAN = DatasetSpec(
    name="uci-taiwan",
    title="Default of credit card clients (Taiwan)",
    source="https://archive.ics.uci.edu/dataset/350/default+of+credit+card+clients",
    license="CC BY 4.0",
    target="default payment next month",
    features=_taiwan_features(),
    excluded=TAIWAN_EXCLUDED,
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_uci_taiwan(path: str | None = None) -> tuple[pd.DataFrame, DatasetSpec]:
    """Return the raw Taiwan rows. Downloads and verifies the file when no path is given."""
    if path:
        xls = Path(path)
    else:
        xls = DATA_DIR / "default of credit card clients.xls"
        if not xls.exists():
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(UCI_TAIWAN_URL, timeout=120) as r:
                payload = r.read()
            with zipfile.ZipFile(io.BytesIO(payload)) as z:
                z.extract("default of credit card clients.xls", DATA_DIR)
    digest = _sha256(xls)
    if digest != UCI_TAIWAN_SHA256:
        raise ValueError(f"Unexpected checksum for {xls}: {digest}")
    df = pd.read_excel(xls, header=1)
    # The source names the most recent status PAY_0 but the amounts BILL_AMT1/PAY_AMT1.
    return df, UCI_TAIWAN


def csv_spec(df: pd.DataFrame, name: str, title: str, source: str, license: str,
             target: str, exclude: list[str], categorical_max_levels: int = 30) -> DatasetSpec:
    """Build a spec for a generic CSV: every non-excluded column becomes a raw
    feature, text columns with few distinct values become categorical."""
    if target not in df.columns:
        raise ValueError(f"Target column {target!r} not in CSV (columns: {list(df.columns)})")
    features: list[FeatureSpec] = []
    for col in df.columns:
        if col == target or col in exclude:
            continue
        series = df[col]
        if pd.api.types.is_numeric_dtype(series):
            features.append(FeatureSpec(col, col.replace("_", " ").strip(), column=col))
        elif series.nunique(dropna=True) <= categorical_max_levels:
            features.append(FeatureSpec(col, col.replace("_", " ").strip(), column=col, categorical=True))
        # Free-text and ID-like columns are skipped.
    return DatasetSpec(name=name, title=title, source=source, license=license,
                       target=target, features=features, excluded=list(exclude))


def load_csv(path: str) -> pd.DataFrame:
    return pd.read_csv(path)
