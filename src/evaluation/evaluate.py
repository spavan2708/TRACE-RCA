import json
import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns
import torch
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    precision_recall_fscore_support,
)

from src.config import (
    DATASET_PATH,
    FEATURE_COLUMNS,
    MODEL_PATH,
    RESULTS_DIR,
    RANDOM_STATE,
)
from src.models.mlp import TraceRCAMLP
from src.preprocessing.preprocess import load_and_prepare_data
from src.training.train import create_loader


def main():
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    (
        X_train,
        X_validation,
        X_test,
        y_train,
        y_validation,
        y_test,
        label_encoder,
    ) = load_and_prepare_data()

    checkpoint = torch.load(MODEL_PATH, map_location="cpu")
    model = TraceRCAMLP(
        input_size=checkpoint["input_size"],
        num_classes=checkpoint["num_classes"],
    )
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    test_loader = create_loader(X_test, y_test)
    predictions = []

    with torch.no_grad():
        for features, _ in test_loader:
            outputs = model(features)
            predictions.extend(outputs.argmax(dim=1).numpy())

    accuracy = accuracy_score(y_test, predictions)
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_test, predictions, average="macro", zero_division=0
    )

    report = classification_report(
        y_test,
        predictions,
        target_names=label_encoder.classes_,
        zero_division=0,
    )

    print(f"Test Accuracy: {accuracy:.4f}")
    print(f"Macro Precision: {precision:.4f}")
    print(f"Macro Recall: {recall:.4f}")
    print(f"Macro F1-score: {f1:.4f}")
    print("\nClassification Report:\n")
    print(report)

    with open(RESULTS_DIR / "classification_report.txt", "w", encoding="utf-8") as file:
        file.write(report)
        file.write(f"\nTest Accuracy: {accuracy:.4f}\n")
        file.write(f"Macro Precision: {precision:.4f}\n")
        file.write(f"Macro Recall: {recall:.4f}\n")
        file.write(f"Macro F1-score: {f1:.4f}\n")

    matrix = confusion_matrix(y_test, predictions)
    plt.figure(figsize=(10, 7))
    sns.heatmap(
        matrix,
        annot=True,
        fmt="d",
        xticklabels=label_encoder.classes_,
        yticklabels=label_encoder.classes_,
    )
    plt.xlabel("Predicted Label")
    plt.ylabel("True Label")
    plt.title("TRACE-RCA MLP Confusion Matrix")
    plt.tight_layout()
    plt.savefig(RESULTS_DIR / "confusion_matrix.png", dpi=200)
    plt.close()

    history_path = RESULTS_DIR / "training_history.json"
    if history_path.exists():
        with open(history_path, "r", encoding="utf-8") as file:
            history = json.load(file)

        plt.figure(figsize=(10, 6))
        plt.plot(history["train_loss"], label="Training Loss")
        plt.plot(history["validation_loss"], label="Validation Loss")
        plt.xlabel("Epoch")
        plt.ylabel("Loss")
        plt.title("Training and Validation Loss")
        plt.legend()
        plt.tight_layout()
        plt.savefig(RESULTS_DIR / "loss_curve.png", dpi=200)
        plt.close()

        plt.figure(figsize=(10, 6))
        plt.plot(history["train_accuracy"], label="Training Accuracy")
        plt.plot(history["validation_accuracy"], label="Validation Accuracy")
        plt.xlabel("Epoch")
        plt.ylabel("Accuracy")
        plt.title("Training and Validation Accuracy")
        plt.legend()
        plt.tight_layout()
        plt.savefig(RESULTS_DIR / "accuracy_curve.png", dpi=200)
        plt.close()

    print(f"Evaluation files saved in: {RESULTS_DIR}")


if __name__ == "__main__":
    main()
