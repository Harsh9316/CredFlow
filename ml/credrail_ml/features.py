"""Feature specs shared by training, export and scoring.

A spec says how to compute one model feature from a raw record. Only two
operations exist, so the TypeScript scorer in packages/engine/src/pd.ts can
reproduce them exactly:

  raw    the value of one column
  ratio  numerator / denominator; 0 when the denominator is 0, missing when
         either side is missing
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class FeatureSpec:
    name: str
    label: str
    op: str = "raw"  # "raw" | "ratio"
    column: Optional[str] = None
    numerator: Optional[str] = None
    denominator: Optional[str] = None
    categorical: bool = False

    def source(self) -> dict:
        if self.op == "raw":
            return {"op": "raw", "column": self.column}
        return {"op": "ratio", "numerator": self.numerator, "denominator": self.denominator}


@dataclass
class DatasetSpec:
    name: str
    title: str
    source: str
    license: str
    target: str
    features: list[FeatureSpec]
    # Columns never used as features, whatever the caller asks for.
    excluded: list[str] = field(default_factory=list)


def ratio(num: pd.Series, den: pd.Series) -> pd.Series:
    num = pd.to_numeric(num, errors="coerce")
    den = pd.to_numeric(den, errors="coerce")
    # Missing inputs stay missing (scored as average); a zero denominator gives 0.
    out = np.where(num.isna() | den.isna(), np.nan, np.where(den == 0, 0.0, num / den.replace(0, np.nan)))
    return pd.Series(out, index=num.index, dtype="float64")


def build_features(df: pd.DataFrame, specs: list[FeatureSpec]) -> pd.DataFrame:
    """Apply feature specs to raw rows. Numeric features come out as float64,
    categorical ones as strings ("" when missing)."""
    out = {}
    for s in specs:
        if s.op == "raw":
            col = df[s.column]
            if s.categorical:
                out[s.name] = col.astype("string").fillna("").astype(str)
            else:
                out[s.name] = pd.to_numeric(col, errors="coerce").astype("float64")
        elif s.op == "ratio":
            out[s.name] = ratio(df[s.numerator], df[s.denominator])
        else:
            raise ValueError(f"Unknown feature op {s.op!r} for {s.name}")
    return pd.DataFrame(out, index=df.index)
