import os
import numpy as np
from PIL import Image
import tensorflow as tf
from tensorflow.keras import layers, models
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

# Faltu warnings disable karne ke liye
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

print("\n--- 🩺 SKIN DISEASE AI TESTER (MOBILENETV2 - 10 CLASSES) ---")

# 🎯 Aapke Dataset ki Exact Classes Order (Alphabetical Folder Sorting)
CLASS_NAMES = [
    "1. Eczema",
    "10. Healthy Skin",
    "2. Melanoma",
    "3. Atopic Dermatitis",
    "4. Basal Cell Carcinoma (BCC)",
    "5. Melanocytic Nevi (NV)",
    "6. Benign Keratosis Lesion(BKL)",
    "7. Psoriasis pictures Lichen Planus and related diseases",
    "8. Seborrheic Keratoses and other Benign Tumors",
    "9. Tinea Ringworm Candidiasis and other Fungal Infections"
]

# 🚀 Confidence Calibration Temperature
TEMPERATURE = 3.5

# 🚀 Weights file ka absolute path
MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
WEIGHTS_PATH = os.path.join(MODEL_DIR, 'skindisease_best_model.weights.h5')

# 1. AI Ka Jism (MobileNetV2 Architecture)
print("⏳ MobileNetV2 Architecture tayyar ho raha hai...")
base_model = MobileNetV2(include_top=False, weights=None, input_shape=(224, 224, 3))

model = models.Sequential([
    base_model,
    layers.GlobalAveragePooling2D(),
    layers.Dropout(0.40),
    layers.Dense(len(CLASS_NAMES), activation=None)  # 10 output classes
])

# 2. AI Ka Dimagh (Weights Load Karna)
try:
    print(f"🧠 Weights load ho rahi hain: {WEIGHTS_PATH}")
    if not os.path.exists(WEIGHTS_PATH):
        raise FileNotFoundError(f"Weights file nahi mili: {WEIGHTS_PATH}")
    
    model.load_weights(WEIGHTS_PATH)
    print("✅ MobileNetV2 Weights Successfully Loaded! Model 100% tayyar hai.")
except Exception as e:
    print(f"❌ FATAL: Weights load nahi hui: {e}")
    raise SystemExit(
        "Model bina sahi weights ke use nahi ho sakta. "
        "Pehle WEIGHTS_PATH confirm karo, phir dobara chalao."
    )


def predict_skin_disease(img_path, debug=False):
    """
    Returns (disease_name, confidence_value)
    """
    if not os.path.exists(img_path):
        print(f"❌ Error: '{img_path}' nahi mili!")
        return "Error: Image not found", 0.0

    try:
        # 1. Image Standardize Karein
        image = Image.open(img_path).convert('RGB').resize((224, 224))

        # 2. Array Conversion
        img_array = np.array(image).astype('float32')
        img_array = np.expand_dims(img_array, axis=0)

        # 3. MobileNetV2 Official Preprocessing
        img_array = preprocess_input(img_array)

        # 4. Raw Predictions (Logits)
        logits = model.predict(img_array, verbose=0)

        if debug:
            print("Logits range:", float(logits.min()), "to", float(logits.max()))
            top3_idx = np.argsort(logits[0])[-3:][::-1]
            print("\nTop 3 raw logits:")
            for idx in top3_idx:
                print(f"   {CLASS_NAMES[idx]}: {logits[0][idx]:.2f}")

        # 5. Temperature Calibrated Softmax
        probs = tf.nn.softmax(logits[0] / TEMPERATURE).numpy()

        result_index = int(np.argmax(probs))
        confidence = float(np.max(probs) * 100)

        disease_name = CLASS_NAMES[result_index]
        confidence_value = round(confidence, 2)

        return disease_name, confidence_value

    except Exception as e:
        print(f"❌ Prediction Error: {e}")
        return "Error: Prediction failed", 0.0


if __name__ == "__main__":
    # Test Run
    disease, conf = predict_skin_disease('test.jpg', debug=True)
    print("\n" + "=" * 50)
    print(f"🎯 AI RESULT: {disease}")
    print(f"📈 CONFIDENCE: {conf}%")
    print("=" * 50)