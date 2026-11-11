# Probability-of-default models

Trains an **advisory** probability-of-default (PD) model in Python and exports it as JSON that the Credrail engine scores in TypeScript. The model sits next to the policy decision and never changes it: `APPROVE`, `REFER` and `REJECT` come only from your credit policy.

```
data ─▶ credrail_ml.train ─▶ models/<name>.json ─▶ engine: scoreDefaultRisk() ─▶ evaluation.defaultRisk
                          └▶ reports/<name>.md          (optional) Claude ─▶ plain-English explanation
```

## Why logistic regression

Every prediction breaks down into per-feature contributions, so the engine can say *why* a borrower scored high, which lenders and regulators expect. Each report also trains a gradient-boosting benchmark on the same split, so you can see how much accuracy the explainable model gives up.

## Fairness

Columns that describe who someone is rather than how they handle credit are never used. For the Taiwan data that is sex, marital status, age and education (`excludedColumns` in the model file). For your own CSV, pass them to `--exclude`.

## Train

```bash
cd ml
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m credrail_ml.train --dataset uci-taiwan     # downloads the data on first run
.venv/bin/python -m pytest -q tests                            # synthetic data, no download
```

Each run writes `models/<name>.json`, `reports/<name>.md` and `models/<name>.parity.json`. The parity file holds sample rows with the probabilities Python computed; the engine's tests check that TypeScript reproduces them.

## Datasets

| Name | Rows | Licence | How to get it |
|---|---|---|---|
| UCI Taiwan credit card default | 30,000 | CC BY 4.0 | Automatic (`--dataset uci-taiwan`) |
| Credit Default Dataset (ICAI book), India | about 10,000 | CDLA-Permissive 1.0 | [Kaggle](https://www.kaggle.com/datasets/kmldas/credit-default-dataset-icai-book), needs a login |
| Automobile Loan Default Dataset, India | large | CC0 | [Kaggle](https://www.kaggle.com/datasets/saurabhbagchi/dish-network-hackathon), needs a login |

Any CSV with a 0/1 default column works:

```bash
.venv/bin/python -m credrail_ml.train --dataset csv --path ~/Downloads/credit_default.csv \
  --name india-icai --target <default column> --exclude <id column> <gender column> \
  --title "Credit Default Dataset (ICAI book)" --license "CDLA-Permissive-1.0" \
  --source "https://www.kaggle.com/datasets/kmldas/credit-default-dataset-icai-book"
```

Numeric columns become numeric features; text columns with up to 30 values become categories; free text and IDs are skipped. Check the column list first and exclude identifiers and protected characteristics.

## Use it in Credrail

```bash
CREDRAIL_PD_MODEL="ml/models/uci-taiwan.json"
```

Then send `riskFeatures` to `POST /api/v1/evaluate`, keyed by the model's source columns (listed under `features[].source` in the model file). Missing inputs are scored as an average applicant and listed in `defaultRisk.missing`. See [docs/API.md](../docs/API.md#advisory-probability-of-default) for the optional explanation.

## Limitations

- The bundled model is trained on Taiwanese credit-card data from 2005. It shows the pipeline working on real data; it is not calibrated for Indian SME lending. Retrain on your own book before relying on it.
- Probabilities describe the training population and drift over time. Watch calibration and retrain.
- A PD model is not a credit policy. Keep human review and your regulator's model-risk expectations in the loop.
