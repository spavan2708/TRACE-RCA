import joblib
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler

from src.config import (
    DATASET_PATH,
    FEATURE_COLUMNS,
    TARGET_COLUMN,
    PREPROCESSOR_PATH,
    SAVED_MODELS_DIR,
    RANDOM_STATE,
)


def load_and_prepare_data():
    dataset = pd.read_csv(DATASET_PATH)

    X = dataset[FEATURE_COLUMNS].copy()
    y_text = dataset[TARGET_COLUMN].copy()

    label_encoder = LabelEncoder()
    y = label_encoder.fit_transform(y_text)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    X_train, X_temp, y_train, y_temp = train_test_split(
        X_scaled,
        y,
        test_size=0.30,
        random_state=RANDOM_STATE,
        stratify=y,
    )

    X_validation, X_test, y_validation, y_test = train_test_split(
        X_temp,
        y_temp,
        test_size=0.50,
        random_state=RANDOM_STATE,
        stratify=y_temp,
    )

    SAVED_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "scaler": scaler,
            "label_encoder": label_encoder,
            "feature_columns": FEATURE_COLUMNS,
        },
        PREPROCESSOR_PATH,
    )

    return (
        X_train,
        X_validation,
        X_test,
        y_train,
        y_validation,
        y_test,
        label_encoder,
    )
