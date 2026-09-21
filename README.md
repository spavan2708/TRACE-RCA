# TRACE-RCA — Root Cause Analysis Console

A local developer console for classifying distributed-system telemetry with the
existing trained PyTorch MLP. The FastAPI application serves the frontend and
performs real inference through `POST /predict`. No frontend build step or CDN is
required.

## Run the complete application

From the repository root on macOS/Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn src.api:app --reload
```

Open **http://127.0.0.1:8000**. API docs: **http://127.0.0.1:8000/docs**.
If the port is occupied, append `--port 8001` and use that port in both URLs.
The current environment uses Python 3.14; dependency availability depends on your
Python version and platform.

The application needs `saved_models/trace_rca_mlp.pt` and
`saved_models/preprocessing.pkl`. These generated artifacts are git-ignored.
Keep the existing pair together. Starting the console does not train a model.
For a new checkout without artifacts, obtain the matching files or run the
separate generation/training workflow below.

## Console

- Ten manually entered telemetry signals, with five demo presets.
- Real predictions, ranked probabilities, suggested investigation steps, and
  clearly labeled heuristic signal indicators.
- Up to 30 local analyses per browser origin, including telemetry snapshots,
  timestamps, and exact API results. History can be viewed, reloaded, exported,
  or cleared. If storage is unavailable, it remains in memory for that page.
- A request JSON inspector, copy/export actions, and factual model metadata.
- Responsive navigation, keyboard focus states, and reduced-motion support.
  `Cmd/Ctrl+Enter` submits the current telemetry.

History is local to the browser and port; it is not an incident database or a
shared service. No live ingestion, authentication, alerting, or cloud integration
is implemented. Do not expose the local demo as a public service without adding
appropriate access controls and operational protections.

## Data semantics

Values are sent directly to `/predict`; the original inference function applies
the saved scaler. CPU, memory, disk, and error rate use a **0–100 percentage
scale**. Error rate `90` is sent as `90`, never converted to `0.9`.

The frontend validates finite, nonnegative values, percentages up to 100, and
whole-number restart counts. Other count features may be fractional, matching
the synthetic generator. Values outside the generator's training range are
flagged without being clamped. The API rejects nonfinite inputs and numerical
overflow without changing its successful prediction response format.

Heuristic thresholds are centralized in `frontend/telemetry.js` and are inclusive:
CPU/memory/disk >=85%, latency >=200ms, errors >=10%, response time >=350ms,
restarts >=3, queue >=60, and DB connections >=140. These are UI indicators,
**not learned explanations**. Investigation steps are suggestions, not fixes.

The classifier always picks one of five failure classes; it has no healthy or
unknown class. Confidence is model output, not proof of an incident. Evaluation
values are read from the existing `results/classification_report.txt`, which
reports performance on synthetic data and does not establish production accuracy.
The existing preprocessing fits the scaler before the train/test split, so the
recorded evaluation also has preprocessing leakage; that training pipeline has
not been changed as part of the console redesign.

## Layout and endpoints

```text
frontend/
  index.html       Semantic application shell
  styles.css       Responsive dark theme and motion
  app.js           API, rendering, history, and interactions
  telemetry.js     Feature definitions, presets, validation, and heuristics
  assets/          Original mark and locally vendored Lucide icons/license
src/api.py         FastAPI routes and static files
```

`/` serves the console; `/static/` serves its assets. `POST /predict` retains the
original payload and result shape. `GET /api/model` loads the saved artifacts to
report readiness, architecture, parameters, and recorded evaluation metrics.
`GET /api/evaluation-report` serves the existing text report. `/docs` remains
FastAPI's interactive API documentation.

## Validation

With the server running:

```bash
python -m src.inference
python -m unittest discover -s tests -p 'test_*.py'
node --test tests/telemetry.test.mjs
```

API smoke tests default to port 8000. Use `TRACE_RCA_TEST_URL=http://127.0.0.1:8001`
for a different port. Optional browser checks use an independently installed
Playwright package: `node tests/browser.mjs`. See that file for environment
options. Test browser data is isolated from your normal browser history.

## Existing model milestone

This module implements the first milestone of TRACE-RCA:
- Synthetic distributed-system telemetry generation
- Data preprocessing
- Baseline MLP training with PyTorch
- Evaluation with accuracy, classification report, and confusion matrix
- Model and preprocessing-artifact saving

### Windows setup

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### Generate, train, evaluate

From the repository root, only when deliberately generating or replacing artifacts:

```bash
python -m src.data_generation.generate_dataset
python -m src.training.train
python -m src.evaluation.evaluate
python -m src.inference
```

Generated files will be placed in:
- `data/raw/telemetry_dataset.csv`
- `saved_models/trace_rca_mlp.pt`
- `saved_models/preprocessing.pkl`
- `results/`

Evaluation also regenerates the preprocessor through the existing preprocessing
code. These commands are separate from starting the UI and were not run during
the frontend redesign.
