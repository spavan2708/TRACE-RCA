import json
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

from src.config import (
    FEATURE_COLUMNS,
    MODEL_PATH,
    NUM_CLASSES,
    RESULTS_DIR,
    RANDOM_STATE,
)
from src.models.mlp import TraceRCAMLP
from src.preprocessing.preprocess import load_and_prepare_data


def set_seed(seed=RANDOM_STATE):
    np.random.seed(seed)
    torch.manual_seed(seed)


def create_loader(X, y, batch_size=64, shuffle=False):
    features = torch.tensor(X, dtype=torch.float32)
    labels = torch.tensor(y, dtype=torch.long)
    return DataLoader(TensorDataset(features, labels), batch_size=batch_size, shuffle=shuffle)


def evaluate_loss(model, loader, criterion, device):
    model.eval()
    total_loss = 0.0
    total_items = 0

    with torch.no_grad():
        for features, labels in loader:
            features, labels = features.to(device), labels.to(device)
            outputs = model(features)
            loss = criterion(outputs, labels)
            total_loss += loss.item() * len(labels)
            total_items += len(labels)

    return total_loss / total_items


def main(epochs=40):
    set_seed()
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)

    (
        X_train,
        X_validation,
        X_test,
        y_train,
        y_validation,
        y_test,
        label_encoder,
    ) = load_and_prepare_data()

    train_loader = create_loader(X_train, y_train, shuffle=True)
    validation_loader = create_loader(X_validation, y_validation)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = TraceRCAMLP(len(FEATURE_COLUMNS), NUM_CLASSES).to(device)

    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001, weight_decay=1e-4)

    history = {
        "train_loss": [],
        "validation_loss": [],
        "train_accuracy": [],
        "validation_accuracy": [],
    }

    best_validation_loss = float("inf")

    for epoch in range(1, epochs + 1):
        model.train()
        correct = 0
        total = 0
        running_loss = 0.0

        for features, labels in train_loader:
            features, labels = features.to(device), labels.to(device)

            optimizer.zero_grad()
            outputs = model(features)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()

            running_loss += loss.item() * len(labels)
            predictions = outputs.argmax(dim=1)
            correct += (predictions == labels).sum().item()
            total += len(labels)

        train_loss = running_loss / total
        train_accuracy = correct / total

        validation_loss = evaluate_loss(model, validation_loader, criterion, device)

        model.eval()
        validation_correct = 0
        validation_total = 0
        with torch.no_grad():
            for features, labels in validation_loader:
                features, labels = features.to(device), labels.to(device)
                predictions = model(features).argmax(dim=1)
                validation_correct += (predictions == labels).sum().item()
                validation_total += len(labels)

        validation_accuracy = validation_correct / validation_total

        history["train_loss"].append(train_loss)
        history["validation_loss"].append(validation_loss)
        history["train_accuracy"].append(train_accuracy)
        history["validation_accuracy"].append(validation_accuracy)

        if validation_loss < best_validation_loss:
            best_validation_loss = validation_loss
            torch.save(
                {
                    "model_state_dict": model.state_dict(),
                    "input_size": len(FEATURE_COLUMNS),
                    "num_classes": NUM_CLASSES,
                    "class_names": list(label_encoder.classes_),
                },
                MODEL_PATH,
            )

        print(
            f"Epoch {epoch:02d}/{epochs} | "
            f"Train Loss: {train_loss:.4f} | "
            f"Val Loss: {validation_loss:.4f} | "
            f"Train Acc: {train_accuracy:.4f} | "
            f"Val Acc: {validation_accuracy:.4f}"
        )

    with open(RESULTS_DIR / "training_history.json", "w", encoding="utf-8") as file:
        json.dump(history, file, indent=2)

    print(f"\nBest model saved to: {MODEL_PATH}")


if __name__ == "__main__":
    main()
