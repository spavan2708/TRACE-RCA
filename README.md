# TRACE-RCA — Basic MLP Model

This module implements the first milestone of TRACE-RCA:
- Synthetic distributed-system telemetry generation
- Data preprocessing
- Baseline MLP training with PyTorch
- Evaluation with accuracy, classification report, and confusion matrix
- Model and preprocessing-artifact saving

## Setup

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

## Run

From the `model` directory:

```bash
python -m src.data_generation.generate_dataset
python -m src.training.train
python -m src.evaluation.evaluate
```

Generated files will be placed in:
- `data/raw/telemetry_dataset.csv`
- `saved_models/trace_rca_mlp.pt`
- `saved_models/preprocessing.pkl`
- `results/`
